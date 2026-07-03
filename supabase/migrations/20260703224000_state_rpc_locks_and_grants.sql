-- Fix (revisão 2026-07-03), três achados medium/low de banco:
-- 1) TOCTOU nas RPCs da máquina de estados: o SELECT do pedido não travava a linha,
--    então dois técnicos podiam assumir a MESMA revisão (o segundo sobrescrevia
--    technician_id em silêncio). Agora todas as RPCs de transição usam FOR UPDATE:
--    o segundo chamador espera o commit do primeiro e cai na checagem de status.
-- 2) deral_ref era legível por anon com preço absoluto (preco_deral), inconsistente
--    com o gating de valor da Frente A. Ninguém lê a tabela diretamente (só as
--    funções SECURITY DEFINER do motor): passa a deny-all como market_listings.
-- 3) As colunas admin-geridas da Frente F (accepts_field_visits, service_regions,
--    field_visit_fee) não estavam fixadas no WITH CHECK de profiles_update_self,
--    permitindo auto-atribuição de disponibilidade/honorário por qualquer usuário.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) FOR UPDATE nas RPCs de estado (corpos atuais, só o lock adicionado)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.assign_technical_review(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
begin
  if not (select public.is_technician()) then
    raise exception 'Apenas a equipe técnica pode assumir a revisão';
  end if;
  select * into v_req from public.appraisal_requests where id = p_request_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_req.status <> 'TECHNICAL_REVIEW_QUEUED' then
    raise exception 'Transição inválida a partir de %', v_req.status;
  end if;
  update public.appraisal_requests
     set status = 'TECHNICAL_REVIEW_IN_PROGRESS', technician_id = v_uid
   where id = p_request_id;
  insert into public.audit_logs (request_id, actor_id, from_status, to_status, action)
  values (p_request_id, v_uid, 'TECHNICAL_REVIEW_QUEUED', 'TECHNICAL_REVIEW_IN_PROGRESS', 'assign');
end $$;

create or replace function public.proceed_to_technical_review(
  p_request_id uuid,
  p_contact_name text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_purpose public.appraisal_purpose default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
begin
  if v_uid is null then raise exception 'Autenticação necessária'; end if;
  select * into v_req from public.appraisal_requests where id = p_request_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_req.requester_id <> v_uid and not (select public.is_admin()) then
    raise exception 'Sem permissão para este pedido';
  end if;
  if v_req.status <> 'ESTIMATE_DELIVERED' then
    raise exception 'Transição inválida a partir de %', v_req.status;
  end if;

  update public.appraisal_requests
     set status = 'TECHNICAL_REVIEW_QUEUED',
         contact_name = coalesce(nullif(btrim(p_contact_name), ''), contact_name),
         contact_email = coalesce(nullif(btrim(p_contact_email), ''), contact_email),
         contact_phone = coalesce(nullif(btrim(p_contact_phone), ''), contact_phone),
         contact_consent_at = case
           when nullif(btrim(p_contact_email), '') is not null then now()
           else contact_consent_at end,
         purpose = coalesce(p_purpose, purpose)
   where id = p_request_id;

  insert into public.audit_logs (request_id, actor_id, from_status, to_status, action, detail)
  values (p_request_id, v_uid, 'ESTIMATE_DELIVERED', 'TECHNICAL_REVIEW_QUEUED', 'proceed_to_review',
          jsonb_build_object('has_contact', nullif(btrim(p_contact_email), '') is not null));
end $$;

create or replace function public.cancel_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
begin
  if v_uid is null then raise exception 'Autenticação necessária'; end if;
  select * into v_req from public.appraisal_requests where id = p_request_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_req.requester_id <> v_uid and not (select public.is_admin()) then
    raise exception 'Sem permissão para este pedido';
  end if;
  if v_req.status not in (
    'DRAFT', 'GEOMETRY_VALIDATING', 'DATA_ENRICHING', 'ENRICHMENT_FAILED',
    'ESTIMATING', 'ESTIMATE_DELIVERED', 'NEEDS_MORE_INFO'
  ) then
    raise exception 'Não é possível cancelar um pedido em status % (revisão técnica/ART em curso ou já entregue)', v_req.status;
  end if;
  update public.appraisal_requests set status = 'CANCELLED_BY_USER' where id = p_request_id;
  insert into public.audit_logs (request_id, actor_id, from_status, to_status, action)
  values (p_request_id, v_uid, v_req.status, 'CANCELLED_BY_USER', 'cancel');
end $$;

create or replace function public.save_technical_review(
  p_request_id uuid,
  p_narrative text default null,
  p_grade text default null,
  p_final_price_per_ha numeric default null,
  p_final_total numeric default null,
  p_adjustments jsonb default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
  v_report uuid;
begin
  if not (select public.is_technician()) then
    raise exception 'Apenas a equipe técnica pode revisar';
  end if;
  select * into v_req from public.appraisal_requests where id = p_request_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_req.technician_id is distinct from v_uid and not (select public.is_admin()) then
    raise exception 'Apenas o engenheiro que assumiu a revisão pode editá-la';
  end if;
  if v_req.status <> 'TECHNICAL_REVIEW_IN_PROGRESS' then
    raise exception 'Rascunho só é permitido durante a revisão técnica (status atual: %)', v_req.status;
  end if;
  if p_grade is not null and p_grade not in ('I', 'II', 'III') then
    raise exception 'Grau inválido: %', p_grade;
  end if;

  insert into public.appraisal_reports as r
    (request_id, technician_id, narrative, grade, final_price_per_ha, final_total, manual_adjustments)
  values (p_request_id, v_uid, p_narrative, coalesce(p_grade, 'II'),
          p_final_price_per_ha, p_final_total, coalesce(p_adjustments, '{}'::jsonb))
  on conflict (request_id) do update
    set narrative = coalesce(p_narrative, r.narrative),
        grade = coalesce(p_grade, r.grade),
        final_price_per_ha = coalesce(p_final_price_per_ha, r.final_price_per_ha),
        final_total = coalesce(p_final_total, r.final_total),
        manual_adjustments = coalesce(p_adjustments, r.manual_adjustments),
        technician_id = v_uid
  returning r.id into v_report;

  return v_report;
end $$;

create or replace function public.submit_art_and_finish(
  p_request_id uuid,
  p_art_number text,
  p_narrative text default null,
  p_art_pdf_path text default null,
  p_grade text default null,
  p_final_price_per_ha numeric default null,
  p_final_total numeric default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
  v_report uuid;
begin
  if not (select public.is_technician()) then
    raise exception 'Apenas a equipe técnica pode emitir o laudo';
  end if;
  if coalesce(btrim(p_art_number), '') = '' then
    raise exception 'Número da ART é obrigatório para emitir o laudo';
  end if;
  if p_grade is not null and p_grade not in ('I', 'II', 'III') then
    raise exception 'Grau inválido: %', p_grade;
  end if;
  if not (select public.caller_crea_ok()) then
    raise exception 'CREA inativo ou validade vencida. Atualize o cadastro (anuidade do CREA) antes de emitir o laudo.';
  end if;

  select * into v_req from public.appraisal_requests where id = p_request_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_req.status <> 'TECHNICAL_REVIEW_IN_PROGRESS' then
    raise exception 'Transição inválida a partir de %', v_req.status;
  end if;
  -- anti-desacoplamento: quem assina a ART é o MESMO que assumiu a revisão
  if v_req.technician_id is distinct from v_uid and not (select public.is_admin()) then
    raise exception 'Apenas o engenheiro responsável que assumiu a revisão pode emitir a ART e finalizar o laudo';
  end if;

  insert into public.appraisal_reports as r
    (request_id, technician_id, art_number, art_pdf_path, narrative, grade, final_price_per_ha, final_total)
  values (p_request_id, v_uid, p_art_number, p_art_pdf_path, p_narrative,
          coalesce(p_grade, 'II'), p_final_price_per_ha, p_final_total)
  on conflict (request_id) do update
    set art_number = excluded.art_number,
        art_pdf_path = coalesce(excluded.art_pdf_path, r.art_pdf_path),
        narrative = coalesce(excluded.narrative, r.narrative),
        grade = coalesce(p_grade, r.grade),
        final_price_per_ha = coalesce(p_final_price_per_ha, r.final_price_per_ha),
        final_total = coalesce(p_final_total, r.final_total),
        technician_id = v_uid
  returning r.id into v_report;

  update public.appraisal_requests set status = 'REPORT_GENERATING' where id = p_request_id;
  insert into public.audit_logs (request_id, actor_id, from_status, to_status, action, detail)
  values (p_request_id, v_uid, 'TECHNICAL_REVIEW_IN_PROGRESS', 'REPORT_GENERATING', 'submit_art',
          jsonb_build_object('art_number', p_art_number, 'art_pdf', p_art_pdf_path is not null,
                             'grade', coalesce(p_grade, 'II')));
  return v_report;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) deral_ref: deny-all (só as funções SECURITY DEFINER do motor leem)
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists deral_ref_read on public.deral_ref;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) profiles_update_self: fixa também as colunas de vistoria (admin-geridas)
--    Mesmo padrão dos helpers definer (evita recursão de RLS em profiles).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.my_accepts_field_visits()
returns boolean language sql stable security definer set search_path = public as $$
  select accepts_field_visits from public.profiles where id = auth.uid();
$$;
create or replace function public.my_service_regions()
returns text[] language sql stable security definer set search_path = public as $$
  select service_regions from public.profiles where id = auth.uid();
$$;
create or replace function public.my_field_visit_fee()
returns numeric language sql stable security definer set search_path = public as $$
  select field_visit_fee from public.profiles where id = auth.uid();
$$;

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (select public.my_role())
    and email is not distinct from (select public.my_email())
    and organization_id is not distinct from (select public.user_organization_id())
    and accepts_field_visits is not distinct from (select public.my_accepts_field_visits())
    and service_regions is not distinct from (select public.my_service_regions())
    and field_visit_fee is not distinct from (select public.my_field_visit_fee())
  );
