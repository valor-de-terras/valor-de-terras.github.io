-- Frente F (vistoria presencial): o registro estruturado da VISTORIA in loco que
-- o responsável técnico faz no imóvel — confirmação de área, benfeitorias, estado
-- de conservação, uso e acesso observados. Isso eleva o Grau de Fundamentação (NBR)
-- e atende à exigência de vistoria das instituições de crédito (Sicoob art. II.11);
-- junto com o relatório fotográfico, constitui a caracterização in loco no laudo.
--
-- FORA daqui (decisão de produto/jurídico/financeiro): marketplace/dispatch, split
-- de pagamento e contrato do engenheiro. A fundação de dados (visit_mode,
-- accepts_field_visits, service_regions, field_visit_fee) veio em 20260703200000.

create table if not exists public.field_visits (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.appraisal_requests (id) on delete cascade,
  technician_id uuid references public.profiles (id) on delete set null,
  visited_at date,
  lat numeric,
  lon numeric,
  area_confirmada boolean,
  area_observacao text,
  estado_conservacao text check (
    estado_conservacao is null or estado_conservacao in ('otimo', 'bom', 'regular', 'ruim', 'na')
  ),
  uso_observado text,
  acesso_observado text,
  recursos_hidricos text,
  benfeitorias jsonb not null default '[]'::jsonb,  -- [{tipo, descricao, area_m2, estado}]
  ressalvas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.field_visits enable row level security;
-- leitura: dono do pedido, técnico responsável ou admin (escritas via RPC)
drop policy if exists field_visits_read on public.field_visits;
create policy field_visits_read on public.field_visits for select to authenticated
  using (
    exists (
      select 1 from public.appraisal_requests r
      where r.id = field_visits.request_id
        and (r.requester_id = auth.uid() or r.technician_id = auth.uid() or (select public.is_admin()))
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- save_field_visit: o RT registra/atualiza a vistoria (upsert). Trava: engenheiro
-- responsável (ou admin), pedido em revisão técnica. Marca o pedido como presencial.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.save_field_visit(
  p_request_id uuid,
  p_data jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
  v_benf jsonb;
  v_estado text;
  v_id uuid;
  v_visited date;
  v_lat numeric;
  v_lon numeric;
  v_areaconf boolean;
begin
  if not (select public.is_technician()) then
    raise exception 'Apenas a equipe técnica pode registrar a vistoria';
  end if;
  select * into v_req from public.appraisal_requests where id = p_request_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_req.technician_id is distinct from v_uid and not (select public.is_admin()) then
    raise exception 'Apenas o engenheiro responsável pode registrar a vistoria';
  end if;
  if v_req.status not in ('TECHNICAL_REVIEW_IN_PROGRESS', 'REPORT_GENERATING', 'DELIVERED') then
    raise exception 'A vistoria só pode ser registrada durante a revisão técnica (status atual: %)', v_req.status;
  end if;

  -- benfeitorias: valida o array e SANEIA cada item (cap de texto + whitelist de
  -- estado + área numérica), em vez de gravar o jsonb do cliente cru.
  v_benf := coalesce(p_data -> 'benfeitorias', '[]'::jsonb);
  if jsonb_typeof(v_benf) <> 'array' then v_benf := '[]'::jsonb; end if;
  if jsonb_array_length(v_benf) > 30 then
    raise exception 'Máximo de 30 benfeitorias por vistoria';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', left(nullif(btrim(e ->> 'tipo'), ''), 80),
           'descricao', left(nullif(btrim(e ->> 'descricao'), ''), 300),
           'area_m2', case when (e ->> 'area_m2') ~ '^\d+(\.\d+)?$' then (e ->> 'area_m2') else null end,
           'estado', case when (e ->> 'estado') in ('otimo','bom','regular','ruim','na') then e ->> 'estado' else null end
         )), '[]'::jsonb)
    into v_benf
  from jsonb_array_elements(v_benf) e;

  v_estado := nullif(p_data ->> 'estado_conservacao', '');
  if v_estado is not null and v_estado not in ('otimo', 'bom', 'regular', 'ruim', 'na') then
    v_estado := null;
  end if;
  -- casts defensivos: entrada malformada vira NULL (não vaza erro cru do Postgres)
  if (p_data ->> 'visited_at') ~ '^\d{4}-\d{2}-\d{2}$' then v_visited := (p_data ->> 'visited_at')::date; end if;
  if (p_data ->> 'lat') ~ '^-?\d+(\.\d+)?$' then v_lat := (p_data ->> 'lat')::numeric; end if;
  if (p_data ->> 'lon') ~ '^-?\d+(\.\d+)?$' then v_lon := (p_data ->> 'lon')::numeric; end if;
  if (p_data ->> 'area_confirmada') in ('true', 'false') then v_areaconf := (p_data ->> 'area_confirmada')::boolean; end if;

  insert into public.field_visits as fv (
    request_id, technician_id, visited_at, lat, lon, area_confirmada, area_observacao,
    estado_conservacao, uso_observado, acesso_observado, recursos_hidricos, benfeitorias, ressalvas
  ) values (
    p_request_id, v_uid, v_visited, v_lat, v_lon, v_areaconf,
    left(nullif(btrim(p_data ->> 'area_observacao'), ''), 500),
    v_estado,
    left(nullif(btrim(p_data ->> 'uso_observado'), ''), 500),
    left(nullif(btrim(p_data ->> 'acesso_observado'), ''), 500),
    left(nullif(btrim(p_data ->> 'recursos_hidricos'), ''), 500),
    v_benf,
    left(nullif(btrim(p_data ->> 'ressalvas'), ''), 1000)
  )
  on conflict (request_id) do update set
    technician_id = v_uid,
    visited_at = excluded.visited_at,
    lat = excluded.lat, lon = excluded.lon,
    area_confirmada = excluded.area_confirmada,
    area_observacao = excluded.area_observacao,
    estado_conservacao = excluded.estado_conservacao,
    uso_observado = excluded.uso_observado,
    acesso_observado = excluded.acesso_observado,
    recursos_hidricos = excluded.recursos_hidricos,
    benfeitorias = excluded.benfeitorias,
    ressalvas = excluded.ressalvas,
    updated_at = now()
  returning fv.id into v_id;

  -- a existência de vistoria implica modalidade presencial
  update public.appraisal_requests set visit_mode = 'presencial' where id = p_request_id;
  return v_id;
end $$;
revoke all on function public.save_field_visit(uuid, jsonb) from public, anon;
grant execute on function public.save_field_visit(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_request_bundle: acrescenta 'field_visit' (escopo restrito).
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
    'photos', case when v_scoped then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'path', storage_path, 'caption', caption, 'sort', sort,
        'lat', lat, 'lon', lon
      ) order by sort, created_at), '[]'::jsonb)
      from public.report_photos ph where ph.request_id = p_request_id
    ) else '[]'::jsonb end,
    'field_visit', case when v_scoped then
      (select to_jsonb(fv) from public.field_visits fv where fv.request_id = p_request_id)
      else null end,
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
