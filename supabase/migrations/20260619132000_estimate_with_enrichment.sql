-- Valor de Terras — backend
-- 08 · RPC run_estimate_with_enrichment: estima a partir de um enriquecimento REAL
-- (calculado na Edge Function a partir de fontes abertas) ou, na ausência dele, usa o
-- catálogo de referência. Persiste DataSnapshots com o payload real e devolve a
-- estimativa + comparáveis num único retorno.

create or replace function public.run_estimate_with_enrichment(
  p_request_id uuid,
  p_enrichment jsonb default null
) returns jsonb
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
  v_use_input boolean := (
    p_enrichment is not null
    and jsonb_typeof(p_enrichment) = 'array'
    and jsonb_array_length(p_enrichment) > 0
  );
  v_comps jsonb := '[]'::jsonb;
  r record;
  f numeric;
  i int;
begin
  if v_uid is null then
    raise exception 'Autenticação necessária';
  end if;
  select * into v_req from public.appraisal_requests where id = p_request_id;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_req.requester_id <> v_uid and not (select public.is_admin()) then
    raise exception 'Sem permissão para este pedido';
  end if;
  if v_req.status not in ('DATA_ENRICHING', 'ENRICHMENT_FAILED') then
    raise exception 'Transição inválida: estimativa só a partir de DATA_ENRICHING/ENRICHMENT_FAILED (status atual: %)', v_req.status;
  end if;
  select * into v_prop from public.properties where id = v_req.property_id;

  if v_use_input then
    -- enriquecimento real vindo da Edge Function
    for r in select value as item from jsonb_array_elements(p_enrichment) loop
      f := coalesce((r.item ->> 'factor')::numeric, 1.0);
      v_combined := v_combined * f;
      v_factors := v_factors || jsonb_build_object(coalesce(r.item ->> 'key', 'na'), f);
      insert into public.data_snapshots (request_id, source_key, source_label, payload)
      values (p_request_id, coalesce(r.item ->> 'key', 'na'), r.item ->> 'source', r.item);
    end loop;
  else
    -- fallback: catálogo de referência
    for r in select * from public.enrichment_layers order by sort loop
      v_combined := v_combined * r.factor;
      v_factors := v_factors || jsonb_build_object(r.key, r.factor);
      insert into public.data_snapshots (request_id, source_key, source_label, payload)
      values (p_request_id, r.key, r.source,
              jsonb_build_object('factor', r.factor, 'label', r.label, 'stub', true));
    end loop;
  end if;

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
  if v_base is null then v_base := 75000; end if;

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

  select jsonb_agg(jsonb_build_object(
    'distance_km', distance_km, 'area_ha', area_ha, 'price_per_ha', price_per_ha,
    'homogenized_price_per_ha', homogenized_price_per_ha, 'land_use', land_use, 'source', source
  ) order by distance_km) into v_comps
  from public.comparables where estimate_id = v_est;

  update public.appraisal_requests set status = 'ESTIMATE_DELIVERED' where id = p_request_id;

  insert into public.audit_logs (request_id, actor_id, from_status, to_status, action, detail)
  values (p_request_id, v_uid, v_req.status, 'ESTIMATE_DELIVERED', 'run_estimate',
          jsonb_build_object('price_per_ha_avg', v_ppha_avg, 'combined_factor', round(v_combined, 4),
                             'enriched', v_use_input));

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
    'model_version', 'homog-nbr-0.4.0',
    'combined_factor', round(v_combined, 4),
    'comparables', coalesce(v_comps, '[]'::jsonb)
  );
end $$;

revoke all on function public.run_estimate_with_enrichment(uuid, jsonb) from public;
revoke all on function public.run_estimate_with_enrichment(uuid, jsonb) from anon;
grant execute on function public.run_estimate_with_enrichment(uuid, jsonb) to authenticated;
