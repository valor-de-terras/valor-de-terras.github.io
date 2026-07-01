-- Valor de Terras — backend
-- 12 · Fluxo completo do laudo formal: contato/consentimento do solicitante,
--      rascunho de revisão técnica, geração de PDF (REPORT_GENERATING -> DELIVERED),
--      RPCs de fila/detalhe para o painel do engenheiro e onboarding da equipe.
-- Aditivo e idempotente. Escritas seguem só por RPC SECURITY DEFINER (auditadas).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Contato + consentimento do solicitante no pedido (captura de lead LGPD-aware)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.appraisal_requests
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists contact_consent_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Campos do laudo para a revisão técnica (grau final, valores concluídos)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.appraisal_reports
  add column if not exists grade text not null default 'II'
    check (grade in ('I', 'II', 'III')),
  add column if not exists final_price_per_ha numeric(14, 2),
  add column if not exists final_total numeric(16, 2),
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists reports_set_updated_at on public.appraisal_reports;
create trigger reports_set_updated_at
before update on public.appraisal_reports
for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) proceed_to_technical_review: cliente decide prosseguir + deixa contato
--    (substitui a versão de 1 argumento)
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.proceed_to_technical_review(uuid);

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
  select * into v_req from public.appraisal_requests where id = p_request_id;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) save_technical_review: engenheiro salva rascunho do laudo (não muda o status)
-- ─────────────────────────────────────────────────────────────────────────────
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
  select * into v_req from public.appraisal_requests where id = p_request_id;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) submit_art_and_finish: registra ART e move para REPORT_GENERATING
--    (o PDF é gerado pela edge function, que então finaliza em DELIVERED).
--    Mantém todas as travas: técnico responsável, CREA válido, ART obrigatória.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.submit_art_and_finish(uuid, text, text, text);

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

  select * into v_req from public.appraisal_requests where id = p_request_id;
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
-- 6) finalize_report_delivery: chamada pela edge function após gerar/gravar o PDF
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.finalize_report_delivery(
  p_request_id uuid,
  p_report_pdf_path text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
begin
  if not (select public.is_technician()) then
    raise exception 'Apenas a equipe técnica pode finalizar o laudo';
  end if;
  if coalesce(btrim(p_report_pdf_path), '') = '' then
    raise exception 'Caminho do PDF é obrigatório';
  end if;
  select * into v_req from public.appraisal_requests where id = p_request_id;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_req.technician_id is distinct from v_uid and not (select public.is_admin()) then
    raise exception 'Apenas o engenheiro responsável pode finalizar este laudo';
  end if;
  if v_req.status <> 'REPORT_GENERATING' then
    raise exception 'Transição inválida a partir de %', v_req.status;
  end if;

  update public.appraisal_reports set report_pdf_path = p_report_pdf_path where request_id = p_request_id;
  update public.appraisal_requests set status = 'DELIVERED' where id = p_request_id;
  insert into public.audit_logs (request_id, actor_id, from_status, to_status, action, detail)
  values (p_request_id, v_uid, 'REPORT_GENERATING', 'DELIVERED', 'report_delivered',
          jsonb_build_object('pdf', p_report_pdf_path));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) get_technician_queue: fila do painel (fila + em andamento + gerando)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_technician_queue()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'created_at'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'request_id', r.id,
      'status', r.status,
      'purpose', r.purpose,
      'created_at', r.created_at,
      'municipality', p.municipality,
      'uf', p.uf,
      'area_ha', p.area_ha,
      'car_code', p.car_code,
      'technician_id', r.technician_id,
      'mine', r.technician_id = (select auth.uid()),
      'contact_name', r.contact_name,
      'total_avg', e.total_avg,
      'grade', rep.grade
    ) as x
    from public.appraisal_requests r
    join public.properties p on p.id = r.property_id
    left join lateral (
      select * from public.appraisal_estimates e2
      where e2.request_id = r.id order by e2.created_at desc limit 1
    ) e on true
    left join public.appraisal_reports rep on rep.request_id = r.id
    where (select public.is_technician())
      and r.status in ('TECHNICAL_REVIEW_QUEUED', 'TECHNICAL_REVIEW_IN_PROGRESS', 'REPORT_GENERATING')
  ) q;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) get_request_bundle: pacote completo para painel, PDF e acompanhamento
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_request_bundle(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
  v_est_id uuid;
  v_out jsonb;
begin
  if v_uid is null then raise exception 'Autenticação necessária'; end if;
  select * into v_req from public.appraisal_requests where id = p_request_id;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if not (
    v_req.requester_id = v_uid
    or v_req.technician_id = v_uid
    or (select public.is_technician())
    or (select public.is_admin())
  ) then
    raise exception 'Sem permissão para este pedido';
  end if;

  select id into v_est_id from public.appraisal_estimates
   where request_id = p_request_id order by created_at desc limit 1;

  select jsonb_build_object(
    'request', to_jsonb(v_req),
    'property', (
      select jsonb_build_object(
        'area_ha', p.area_ha, 'perimeter_km', p.perimeter_km,
        'municipality', p.municipality, 'uf', p.uf, 'car_code', p.car_code,
        'origin', p.origin,
        'centroid', jsonb_build_array(ST_X(p.centroid), ST_Y(p.centroid)),
        'geometry', ST_AsGeoJSON(p.geom)::jsonb
      ) from public.properties p where p.id = v_req.property_id
    ),
    'estimate', (select to_jsonb(e) from public.appraisal_estimates e where e.id = v_est_id),
    'comparables', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.distance_km), '[]'::jsonb)
      from public.comparables c where c.estimate_id = v_est_id
    ),
    'enrichment', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', source_key, 'source', source_label, 'payload', payload
      ) order by captured_at), '[]'::jsonb)
      from public.data_snapshots s where s.request_id = p_request_id
    ),
    'report', (select to_jsonb(rep) from public.appraisal_reports rep where rep.request_id = p_request_id),
    'technician', (
      select jsonb_build_object(
        'full_name', pr.full_name, 'email', pr.email,
        'crea_number', t.crea_number, 'uf', t.uf, 'specialty', t.specialty,
        'crea_valid_until', t.crea_valid_until
      )
      from public.profiles pr
      left join public.technical_team_members t on t.profile_id = pr.id
      where pr.id = v_req.technician_id
    ),
    'audit', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', action, 'from', from_status, 'to', to_status, 'at', created_at
      ) order by created_at), '[]'::jsonb)
      from public.audit_logs a where a.request_id = p_request_id
    )
  ) into v_out;

  return v_out;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) get_my_requests: acompanhamento do solicitante
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_my_requests()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'request_id', r.id, 'status', r.status, 'created_at', r.created_at,
      'municipality', p.municipality, 'uf', p.uf, 'area_ha', p.area_ha,
      'total_avg', e.total_avg,
      'has_report', rep.report_pdf_path is not null,
      'grade', rep.grade, 'art_number', rep.art_number
    ) as x
    from public.appraisal_requests r
    join public.properties p on p.id = r.property_id
    left join lateral (
      select * from public.appraisal_estimates e2
      where e2.request_id = r.id order by e2.created_at desc limit 1
    ) e on true
    left join public.appraisal_reports rep on rep.request_id = r.id
    where r.requester_id = (select auth.uid())
  ) q;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10) admin_upsert_technician: onboarding sem segredos no git.
--     A pessoa cria a própria conta (e-mail+senha); o admin a promove.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_upsert_technician(
  p_email text,
  p_crea text,
  p_uf text,
  p_specialty text default null,
  p_valid_months int default 12
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pid uuid;
begin
  if not (select public.is_admin()) then
    raise exception 'Apenas admin pode cadastrar a equipe técnica';
  end if;
  select id into v_pid from public.profiles where lower(email) = lower(btrim(p_email));
  if v_pid is null then
    raise exception 'Nenhum usuário com e-mail % (peça para a pessoa criar a conta primeiro)', p_email;
  end if;
  update public.profiles set role = 'technician' where id = v_pid and role <> 'admin';
  insert into public.technical_team_members
    (profile_id, crea_number, uf, specialty, active, crea_active, crea_valid_until)
  values (v_pid, p_crea, upper(p_uf), p_specialty, true, true,
          current_date + make_interval(months => p_valid_months))
  on conflict (profile_id) do update
    set crea_number = excluded.crea_number, uf = excluded.uf,
        specialty = excluded.specialty, active = true, crea_active = true,
        crea_valid_until = excluded.crea_valid_until;
  return v_pid;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permissões: revoga de public/anon, concede só a authenticated (RPCs se autoguardam)
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.proceed_to_technical_review(uuid, text, text, text, public.appraisal_purpose) from public, anon;
revoke all on function public.save_technical_review(uuid, text, text, numeric, numeric, jsonb) from public, anon;
revoke all on function public.submit_art_and_finish(uuid, text, text, text, text, numeric, numeric) from public, anon;
revoke all on function public.finalize_report_delivery(uuid, text) from public, anon;
revoke all on function public.get_technician_queue() from public, anon;
revoke all on function public.get_request_bundle(uuid) from public, anon;
revoke all on function public.get_my_requests() from public, anon;
revoke all on function public.admin_upsert_technician(text, text, text, text, int) from public, anon;

grant execute on function public.proceed_to_technical_review(uuid, text, text, text, public.appraisal_purpose) to authenticated;
grant execute on function public.save_technical_review(uuid, text, text, numeric, numeric, jsonb) to authenticated;
grant execute on function public.submit_art_and_finish(uuid, text, text, text, text, numeric, numeric) to authenticated;
grant execute on function public.finalize_report_delivery(uuid, text) to authenticated;
grant execute on function public.get_technician_queue() to authenticated;
grant execute on function public.get_request_bundle(uuid) to authenticated;
grant execute on function public.get_my_requests() to authenticated;
grant execute on function public.admin_upsert_technician(text, text, text, text, int) to authenticated;
