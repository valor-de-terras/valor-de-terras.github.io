-- Valor de Terras — backend
-- 03 · Funções (triggers, RBAC helpers e RPC do fluxo de avaliação)

-- updated_at automático
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists requests_set_updated_at on public.appraisal_requests;
create trigger requests_set_updated_at
before update on public.appraisal_requests
for each row execute function public.set_updated_at();

-- Cria profile ao surgir um auth.users
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Helpers de papel (security definer para evitar recursão de RLS)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_technician()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('technician', 'admin'));
$$;

-- Papel atual do usuário (usado no WITH CHECK de profiles para barrar auto-escalonamento)
create or replace function public.my_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Organização do usuário (usado na RLS de organizations, evita sub-select sob RLS)
create or replace function public.user_organization_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

-- Extrai uma geometria PostGIS de um GeoJSON (Feature, FeatureCollection ou geometry)
create or replace function public._extract_geom(p jsonb)
returns extensions.geometry
language plpgsql stable set search_path = public, extensions as $$
declare
  g jsonb;
  geo extensions.geometry;
begin
  if (p ->> 'type') = 'FeatureCollection' then
    g := p -> 'features' -> 0 -> 'geometry';
  elsif (p ->> 'type') = 'Feature' then
    g := p -> 'geometry';
  else
    g := p;
  end if;
  if g is null then
    raise exception 'GeoJSON sem geometria';
  end if;
  geo := ST_SetSRID(ST_GeomFromGeoJSON(g::text), 4326);
  if GeometryType(geo) = 'POLYGON' then
    geo := ST_Multi(geo);
  end if;
  return geo;
end $$;

-- RPC: cria pedido de avaliação a partir da geometria
create or replace function public.create_appraisal_request(
  p_geojson jsonb,
  p_purpose public.appraisal_purpose default 'outro',
  p_origin public.property_origin default 'geojson',
  p_car_code text default null,
  p_municipality text default null,
  p_uf text default null
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_geom extensions.geometry;
  v_area numeric;
  v_perim numeric;
  v_prop uuid;
  v_req uuid;
begin
  if v_uid is null then
    raise exception 'Autenticação necessária';
  end if;
  v_geom := public._extract_geom(p_geojson);
  if v_geom is null or not ST_IsValid(v_geom) then
    raise exception 'Geometria inválida (verifique topologia)';
  end if;
  v_area := ST_Area(v_geom::geography) / 10000.0;
  v_perim := ST_Perimeter(v_geom::geography) / 1000.0;
  if v_area <= 0 then
    raise exception 'Área medida é zero (geometria sem polígonos)';
  end if;

  insert into public.properties (
    owner_id, origin, geom, area_ha, perimeter_km, centroid, car_code, municipality, uf
  ) values (
    v_uid, p_origin, v_geom, round(v_area, 4), round(v_perim, 4),
    ST_Centroid(v_geom), p_car_code, p_municipality, p_uf
  ) returning id into v_prop;

  insert into public.appraisal_requests (property_id, requester_id, purpose, status)
  values (v_prop, v_uid, p_purpose, 'DATA_ENRICHING')
  returning id into v_req;

  insert into public.audit_logs (request_id, actor_id, from_status, to_status, action, detail)
  values (v_req, v_uid, null, 'DATA_ENRICHING', 'create_request',
          jsonb_build_object('area_ha', round(v_area, 4), 'origin', p_origin::text));

  return v_req;
end $$;

-- RPC: enriquecimento (stub) + motor de homogeneização NBR + estimativa preliminar
create or replace function public.run_preliminary_estimate(p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
  v_prop public.properties;
  v_combined numeric := 1.0;
  v_base numeric;
  v_ppha_avg numeric;
  v_ppha_min numeric;
  v_ppha_max numeric;
  v_est uuid;
  v_factors jsonb := '{}'::jsonb;
  v_n_comp constant int := 6;
  r record;
  i int;
begin
  if v_uid is null then
    raise exception 'Autenticação necessária';
  end if;
  select * into v_req from public.appraisal_requests where id = p_request_id;
  if not found then
    raise exception 'Pedido não encontrado';
  end if;
  if v_req.requester_id <> v_uid and not (select public.is_admin()) then
    raise exception 'Sem permissão para este pedido';
  end if;
  -- guarda da máquina de estados: só estima a partir do enriquecimento
  if v_req.status not in ('DATA_ENRICHING', 'ENRICHMENT_FAILED') then
    raise exception 'Transição inválida: estimativa só a partir de DATA_ENRICHING/ENRICHMENT_FAILED (status atual: %)', v_req.status;
  end if;

  select * into v_prop from public.properties where id = v_req.property_id;

  -- fan-out de enriquecimento: congela um DataSnapshot por camada e acumula o fator
  for r in select * from public.enrichment_layers order by sort loop
    v_combined := v_combined * r.factor;
    v_factors := v_factors || jsonb_build_object(r.key, r.factor);
    insert into public.data_snapshots (request_id, source_key, source_label, payload)
    values (p_request_id, r.key, r.source,
            jsonb_build_object('factor', r.factor, 'label', r.label, 'stub', true));
  end loop;

  -- preço-base regional: município -> UF -> default
  select base_price_per_ha into v_base
    from public.regional_base_prices
   where uf = coalesce(v_prop.uf, '') and municipality is not distinct from v_prop.municipality
   limit 1;
  if v_base is null then
    select base_price_per_ha into v_base
      from public.regional_base_prices
     where uf = coalesce(v_prop.uf, '') and municipality is null
     limit 1;
  end if;
  if v_base is null then
    v_base := 75000;
  end if;

  v_ppha_avg := round((v_base * v_combined) / 100) * 100;
  v_ppha_min := round((v_ppha_avg * 0.88) / 100) * 100;
  v_ppha_max := round((v_ppha_avg * 1.13) / 100) * 100;

  insert into public.appraisal_estimates (
    request_id, price_per_ha_min, price_per_ha_avg, price_per_ha_max,
    total_min, total_avg, total_max, grade, comparables_used, factors
  ) values (
    p_request_id, v_ppha_min, v_ppha_avg, v_ppha_max,
    round(v_ppha_min * v_prop.area_ha, 2), round(v_ppha_avg * v_prop.area_ha, 2),
    round(v_ppha_max * v_prop.area_ha, 2), 'normal', v_n_comp, v_factors
  ) returning id into v_est;

  -- comparáveis sintéticos determinísticos (mock, marcados como tal)
  for i in 0 .. (v_n_comp - 1) loop
    insert into public.comparables (
      estimate_id, distance_km, area_ha, price_per_ha, homogenized_price_per_ha, land_use, source
    ) values (
      v_est,
      round((3 + i * 3.4 + (i * 7) % 5)::numeric, 1),
      round((v_prop.area_ha * (0.55 + ((i * 13) % 9) / 10.0))::numeric),
      round((v_base * (0.86 + ((i * 17) % 28) / 100.0)) / 100) * 100,
      round((v_base * (0.86 + ((i * 17) % 28) / 100.0) * (0.94 + ((i * 11) % 13) / 100.0)) / 100) * 100,
      (array['Lavoura anual', 'Lavoura/pecuária', 'Pastagem formada', 'Lavoura irrigada'])[1 + (i % 4)],
      (array['DERAL/SEAB-PR', 'CEPEA/ESALQ', 'Cartório (parceria)', 'DERAL/SEAB-PR'])[1 + (i % 4)]
    );
  end loop;

  update public.appraisal_requests
     set status = 'ESTIMATE_DELIVERED'
   where id = p_request_id;

  insert into public.audit_logs (request_id, actor_id, from_status, to_status, action, detail)
  values (p_request_id, v_uid, v_req.status, 'ESTIMATE_DELIVERED', 'run_estimate',
          jsonb_build_object('price_per_ha_avg', v_ppha_avg, 'combined_factor', round(v_combined, 4)));

  return jsonb_build_object(
    'request_id', p_request_id,
    'estimate_id', v_est,
    'area_ha', v_prop.area_ha,
    'price_per_ha', jsonb_build_object('min', v_ppha_min, 'avg', v_ppha_avg, 'max', v_ppha_max),
    'total', jsonb_build_object(
      'min', round(v_ppha_min * v_prop.area_ha, 2),
      'avg', round(v_ppha_avg * v_prop.area_ha, 2),
      'max', round(v_ppha_max * v_prop.area_ha, 2)
    ),
    'grade', 'normal',
    'comparables_used', v_n_comp,
    'model_version', 'homog-nbr-0.3.1'
  );
end $$;

-- RPC: cliente decide prosseguir para o laudo formal com ART
create or replace function public.proceed_to_technical_review(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
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
  update public.appraisal_requests set status = 'TECHNICAL_REVIEW_QUEUED' where id = p_request_id;
  insert into public.audit_logs (request_id, actor_id, from_status, to_status, action)
  values (p_request_id, v_uid, 'ESTIMATE_DELIVERED', 'TECHNICAL_REVIEW_QUEUED', 'proceed_to_review');
end $$;

-- RPC: cancelar pedido (apenas em estados não terminais / sem ART em curso)
create or replace function public.cancel_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
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

-- RPC: engenheiro assume a revisão técnica
create or replace function public.assign_technical_review(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.appraisal_requests;
begin
  if not (select public.is_technician()) then
    raise exception 'Apenas a equipe técnica pode assumir a revisão';
  end if;
  select * into v_req from public.appraisal_requests where id = p_request_id;
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

-- RPC: registra ART e finaliza o laudo (apenas o técnico responsável)
create or replace function public.submit_art_and_finish(
  p_request_id uuid,
  p_art_number text,
  p_narrative text default null
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
  select * into v_req from public.appraisal_requests where id = p_request_id;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_req.status <> 'TECHNICAL_REVIEW_IN_PROGRESS' then
    raise exception 'Transição inválida a partir de %', v_req.status;
  end if;
  if v_req.technician_id is distinct from v_uid and not (select public.is_admin()) then
    raise exception 'Apenas o técnico responsável por este pedido pode finalizar o laudo';
  end if;
  insert into public.appraisal_reports (request_id, technician_id, art_number, narrative)
  values (p_request_id, v_uid, p_art_number, p_narrative)
  on conflict (request_id) do update
    set art_number = excluded.art_number,
        narrative = excluded.narrative,
        technician_id = excluded.technician_id
  returning id into v_report;
  update public.appraisal_requests set status = 'DELIVERED' where id = p_request_id;
  insert into public.audit_logs (request_id, actor_id, from_status, to_status, action, detail)
  values (p_request_id, v_uid, v_req.status, 'DELIVERED', 'submit_art',
          jsonb_build_object('art_number', p_art_number));
  return v_report;
end $$;

-- Permissões de execução: revoga do public (inclui anon) e concede só ao authenticated
revoke all on function public.create_appraisal_request(jsonb, public.appraisal_purpose, public.property_origin, text, text, text) from public;
revoke all on function public.run_preliminary_estimate(uuid) from public;
revoke all on function public.proceed_to_technical_review(uuid) from public;
revoke all on function public.cancel_request(uuid) from public;
revoke all on function public.assign_technical_review(uuid) from public;
revoke all on function public.submit_art_and_finish(uuid, text, text) from public;
revoke all on function public.is_admin() from public;
revoke all on function public.is_technician() from public;
revoke all on function public.my_role() from public;
revoke all on function public.user_organization_id() from public;

grant execute on function public.create_appraisal_request(jsonb, public.appraisal_purpose, public.property_origin, text, text, text) to authenticated;
grant execute on function public.run_preliminary_estimate(uuid) to authenticated;
grant execute on function public.proceed_to_technical_review(uuid) to authenticated;
grant execute on function public.cancel_request(uuid) to authenticated;
grant execute on function public.assign_technical_review(uuid) to authenticated;
grant execute on function public.submit_art_and_finish(uuid, text, text) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_technician() to authenticated;
grant execute on function public.my_role() to authenticated;
grant execute on function public.user_organization_id() to authenticated;
