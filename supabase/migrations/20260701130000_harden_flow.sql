-- Valor de Terras — backend
-- 14 · Hardening do fluxo (achados da revisão adversarial):
--   [HIGH] escalonamento a técnico via profiles.email mutável (admin_upsert_technician)
--   [LOW]  profiles_update_self não fixa email/organization_id (auto-atribuição)
--   [LOW]  get_request_bundle expõe snapshots/auditoria a QUALQUER técnico (RLS quer só o responsável)
--   [LOW]  finalize_report_delivery aceita caminho de PDF arbitrário (não valida pertencer ao pedido)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) RLS de profiles: além de id e role, fixa email e organization_id no WITH CHECK.
--    Impede que o cliente edite o próprio e-mail (chave de promoção) ou se auto-atribua
--    a uma organização. As RPCs SECURITY DEFINER (owner) não passam por esta policy.
-- ─────────────────────────────────────────────────────────────────────────────
-- helper SECURITY DEFINER para o e-mail atual (evita recursão de RLS ao referenciar
-- profiles dentro de uma policy de profiles, tal como my_role()/user_organization_id())
create or replace function public.my_email()
returns text language sql stable security definer set search_path = public as $$
  select email from public.profiles where id = auth.uid();
$$;
revoke all on function public.my_email() from public, anon;
grant execute on function public.my_email() to authenticated;

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (select public.my_role())
    and email is not distinct from (select public.my_email())
    and organization_id is not distinct from (select public.user_organization_id())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) admin_upsert_technician: resolve o alvo pela tabela AUTORITATIVA auth.users
--    (e-mail confirmado, único), não por profiles.email (texto livre editável).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_upsert_technician(
  p_email text,
  p_crea text,
  p_uf text,
  p_specialty text default null,
  p_valid_months int default 12
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
  v_email text;
begin
  if not (select public.is_admin()) then
    raise exception 'Apenas admin pode cadastrar a equipe técnica';
  end if;

  -- e-mail autoritativo e confirmado, direto do provedor de identidade
  select u.id, u.email into v_uid, v_email
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
     and u.email_confirmed_at is not null;
  if v_uid is null then
    raise exception 'Nenhum usuário confirmado com e-mail % (peça para a pessoa criar e confirmar a conta primeiro)', p_email;
  end if;

  -- garante o profile (o trigger handle_new_user já cria) e promove a técnico
  insert into public.profiles (id, email, role)
  values (v_uid, v_email, 'technician')
  on conflict (id) do update set role = 'technician';

  insert into public.technical_team_members
    (profile_id, crea_number, uf, specialty, active, crea_active, crea_valid_until)
  values (v_uid, p_crea, upper(p_uf), p_specialty, true, true,
          current_date + make_interval(months => p_valid_months))
  on conflict (profile_id) do update
    set crea_number = excluded.crea_number, uf = excluded.uf,
        specialty = excluded.specialty, active = true, crea_active = true,
        crea_valid_until = excluded.crea_valid_until;
  return v_uid;
end $$;

revoke all on function public.admin_upsert_technician(text, text, text, text, int) from public, anon;
grant execute on function public.admin_upsert_technician(text, text, text, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) finalize_report_delivery: valida que o caminho do PDF pertence ao pedido
--    (evita entregar, via service role, o PDF de outro pedido).
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
  -- o objeto tem que estar sob o prefixo do próprio pedido
  if p_report_pdf_path not like (p_request_id::text || '/%') then
    raise exception 'Caminho do PDF não pertence a este pedido';
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
-- 4) get_request_bundle: mantém leitura ampla p/ a fila do técnico (request/property/
--    estimate/comparables/report), mas escopa data_snapshots e audit_logs ao mesmo
--    conjunto que a RLS pretende (solicitante, técnico RESPONSÁVEL ou admin).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_request_bundle(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
  v_est_id uuid;
  v_scoped boolean;
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

  -- escopo restrito (para snapshots/auditoria): dono, técnico responsável ou admin
  v_scoped := (v_req.requester_id = v_uid or v_req.technician_id = v_uid or (select public.is_admin()));

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
    'enrichment', case when v_scoped then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', source_key, 'source', source_label, 'payload', payload
      ) order by captured_at), '[]'::jsonb)
      from public.data_snapshots s where s.request_id = p_request_id
    ) else '[]'::jsonb end,
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
    'audit', case when v_scoped then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', action, 'from', from_status, 'to', to_status, 'at', created_at
      ) order by created_at), '[]'::jsonb)
      from public.audit_logs a where a.request_id = p_request_id
    ) else '[]'::jsonb end
  ) into v_out;

  return v_out;
end $$;
