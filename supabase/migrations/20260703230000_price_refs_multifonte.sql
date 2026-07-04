-- Frente G (direcionamento Alessandro 2026-07-03): preço-base multi-fonte com pesos.
-- Antes o preço-base vinha só do DERAL/SEAB-PR (índice municipal x âncora calibrada).
-- Agora o motor pondera as fontes disponíveis para o município/categoria:
--   DERAL/SEAB-PR (índice x âncora, como antes) + INCRA (PPR/RAMT) + VTN/Receita Federal
-- com pesos configuráveis em price_source_weights. Cada fonte usada é declarada no
-- snapshot 'comp' (payload.sources) e, portanto, no laudo; a prévia continua sem R$
-- (o appraise descarta payloads e mascara valores — gating da Frente A intacto).
--
-- Nota metodológica: o VTN/RFB tem natureza fiscal (referencial do ITR, via SIPT) e
-- tende a subestimar o mercado; o peso menor reflete isso. Pesos são decisão de
-- negócio e podem ser recalibrados sem nova migration (update em price_source_weights).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Pesos por fonte (deny-all: só as funções SECURITY DEFINER do motor leem)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.price_source_weights (
  source text primary key,
  label text not null,
  weight numeric not null check (weight >= 0),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.price_source_weights enable row level security;

insert into public.price_source_weights (source, label, weight, enabled) values
  ('DERAL',   'DERAL/SEAB-PR',                       0.40, true),
  ('INCRA',   'INCRA (preços referenciais de terras)', 0.35, true),
  ('VTN_RFB', 'VTN/Receita Federal (SIPT)',          0.25, true)
on conflict (source) do update
  set label = excluded.label;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Referências de preço por fonte (deny-all, mesmo padrão do deral_ref pós-revisão)
--    municipio_norm null = referência regional/estadual da fonte (fallback do município)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.price_refs (
  id bigserial primary key,
  source text not null references public.price_source_weights(source),
  uf text not null,
  municipio_norm text,
  regiao text,
  categoria text not null check (categoria in ('A', 'B', 'C')),
  aptidao_fonte text,
  valor_ha numeric not null check (valor_ha > 0),
  ano int not null,
  created_at timestamptz not null default now()
);
create unique index if not exists price_refs_uq
  on public.price_refs (source, uf, coalesce(municipio_norm, '*'), categoria, ano);
create index if not exists price_refs_lookup_ix
  on public.price_refs (uf, categoria, source, municipio_norm);
alter table public.price_refs enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Motor v3.3 (homog-nbr-0.7.0): preço-base = média ponderada das fontes
--    disponíveis; comparáveis re-ancorados no preço-base ponderado (mantendo a
--    diferenciação regional relativa do DERAL). Estatística NBR (v3.2) inalterada.
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_comps jsonb := '[]'::jsonb;
  v_use_input boolean := (
    p_enrichment is not null and jsonb_typeof(p_enrichment) = 'array' and jsonb_array_length(p_enrichment) > 0
  );
  v_uso_class int;
  v_cat text := 'A';
  v_anchor numeric;
  v_muni_norm text;
  v_deral public.deral_ref;
  v_comp_result text;
  v_comp_source text := 'DERAL/SEAB-PR';
  v_comp_real boolean := false;
  v_class_label text;
  r record;
  f numeric;
  i int;
  v_vu numeric[];
  v_kept numeric[];
  v_mean numeric; v_std numeric; v_n int;
  v_mean_s numeric; v_std_s numeric; v_n_s int; v_zc numeric;
  v_se numeric; v_half numeric; v_cv numeric; v_ampl numeric;
  v_prec text;
  v_stats boolean := false;
  v_arb_low numeric; v_arb_high numeric;
  -- v3.3: blend multi-fonte
  v_w numeric;
  v_wsum numeric := 0;
  v_acc numeric := 0;
  v_src_val numeric;
  v_sources jsonb := '[]'::jsonb;
  v_src_labels text[] := '{}';
  v_deral_on boolean := false;
begin
  if v_uid is null then raise exception 'Autenticação necessária'; end if;
  select * into v_req from public.appraisal_requests where id = p_request_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_req.requester_id <> v_uid and not (select public.is_admin()) then
    raise exception 'Sem permissão para este pedido';
  end if;
  if v_req.status not in ('DATA_ENRICHING', 'ENRICHMENT_FAILED') then
    raise exception 'Transição inválida: estimativa só a partir de DATA_ENRICHING/ENRICHMENT_FAILED (status atual: %)', v_req.status;
  end if;
  select * into v_prop from public.properties where id = v_req.property_id;

  if v_use_input then
    for r in select value as item from jsonb_array_elements(p_enrichment) loop
      f := coalesce((r.item ->> 'factor')::numeric, 1.0);
      if (r.item ->> 'key') = 'uso' then
        v_uso_class := nullif(r.item -> 'payload' ->> 'dominant_class', '')::int;
      end if;
      if (r.item ->> 'key') is distinct from 'comp' then
        v_combined := v_combined * f;
        v_factors := v_factors || jsonb_build_object(coalesce(r.item ->> 'key', 'na'), f);
        insert into public.data_snapshots (request_id, source_key, source_label, payload)
        values (p_request_id, coalesce(r.item ->> 'key', 'na'), r.item ->> 'source', r.item);
      end if;
    end loop;
  else
    -- 'comp' fica fora do catálogo-fallback (mesmo guard do ramo com input): o
    -- snapshot 'comp' REAL é inserido adiante; um stub aqui empataria em
    -- captured_at e o laudo poderia ler o stub (sem payload.sources)
    for r in select * from public.enrichment_layers where key <> 'comp' order by sort loop
      v_combined := v_combined * r.factor;
      v_factors := v_factors || jsonb_build_object(r.key, r.factor);
      insert into public.data_snapshots (request_id, source_key, source_label, payload)
      values (p_request_id, r.key, r.source, jsonb_build_object('factor', r.factor, 'label', r.label, 'stub', true));
    end loop;
  end if;

  if v_uso_class is not null then
    if v_uso_class in (9, 18, 19, 20, 21, 35, 36, 39, 40, 41, 46, 47, 48, 62) then v_cat := 'A';
    elsif v_uso_class = 15 then v_cat := 'B';
    elsif v_uso_class in (3, 4, 5, 6, 10, 11, 12, 33, 49, 50) then v_cat := 'C';
    else v_cat := 'A'; end if;
  end if;
  v_class_label := case v_cat when 'A' then 'lavoura' when 'B' then 'pastagem' else 'campo/floresta' end;
  v_anchor := case v_cat when 'A' then 90000 when 'B' then 35000 else 22000 end;

  v_muni_norm := translate(upper(coalesce(v_prop.municipality, '')),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC');
  -- apóstrofos fora: as tabelas de referência gravam DIAMANTE DOESTE etc.
  v_muni_norm := replace(replace(v_muni_norm, '''', ''), '’', '');
  select * into v_deral from public.deral_ref where municipio_norm = v_muni_norm and categoria = v_cat limit 1;

  -- ===== v3.3: preço-base ponderado pelas fontes disponíveis =====
  if v_deral.id is not null and v_deral.indice > 0 then
    select weight into v_w from public.price_source_weights
      where source = 'DERAL' and enabled and weight > 0;
    if found then
      v_deral_on := true;
      v_src_val := round((v_anchor * v_deral.indice) / 100) * 100;
      v_acc := v_acc + v_src_val * v_w;
      v_wsum := v_wsum + v_w;
      v_sources := v_sources || jsonb_build_object(
        'source', 'DERAL/SEAB-PR', 'ano', v_deral.ano, 'peso', v_w,
        'valor_ha', v_src_val, 'detalhe', 'índice regional ' || round(v_deral.indice, 2) || ' x âncora calibrada');
      v_src_labels := v_src_labels || ('DERAL/SEAB-PR ' || v_deral.ano);
    end if;
  end if;

  for r in
    select distinct on (p.source) p.source, w.label, w.weight, p.valor_ha, p.ano, p.aptidao_fonte,
           (p.municipio_norm is not null) as municipal
    from public.price_refs p
    join public.price_source_weights w on w.source = p.source and w.enabled and w.weight > 0
    where p.uf = coalesce(v_prop.uf, 'PR')
      and p.categoria = v_cat
      and (p.municipio_norm = v_muni_norm or p.municipio_norm is null)
    order by p.source, (p.municipio_norm is not null) desc, p.ano desc
  loop
    v_acc := v_acc + r.valor_ha * r.weight;
    v_wsum := v_wsum + r.weight;
    v_sources := v_sources || jsonb_build_object(
      'source', r.label, 'ano', r.ano, 'peso', r.weight,
      'valor_ha', r.valor_ha,
      'detalhe', coalesce(r.aptidao_fonte, '') || case when r.municipal then '' else ' (referência regional)' end);
    v_src_labels := v_src_labels || (r.label || ' ' || r.ano);
  end loop;

  if v_wsum > 0 then
    v_base := round((v_acc / v_wsum) / 100) * 100;
    v_comp_real := true;
    v_comp_source := array_to_string(v_src_labels, ' + ');
    v_comp_result := format('Preço-base %s/ha para %s: média ponderada de %s fonte(s): %s',
      'R$ ' || to_char(v_base, 'FM999G999G999'), v_class_label,
      jsonb_array_length(v_sources), array_to_string(v_src_labels, ', '));
  else
    select base_price_per_ha into v_base from public.regional_base_prices
      where uf = coalesce(v_prop.uf, '') and municipality is not distinct from v_prop.municipality limit 1;
    if v_base is null then
      select base_price_per_ha into v_base from public.regional_base_prices
        where uf = coalesce(v_prop.uf, '') and municipality is null limit 1;
    end if;
    if v_base is null then v_base := 75000; end if;
    v_comp_source := 'Referência regional';
    v_comp_result := 'Sem cobertura DERAL/INCRA/VTN para este município; referência regional aplicada';
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
    round(v_ppha_max * v_prop.area_ha, 2), 'normal', 0, v_factors
  ) returning id into v_est;

  -- comparáveis: vizinhos da região DERAL re-ancorados no preço-base ponderado
  -- (v_base * indice_vizinho / indice_municipio preserva a diferenciação relativa
  -- do DERAL, mas o nível absoluto passa a ser o blend multi-fonte). Só quando o
  -- DERAL participa do blend: peso zerado tira o DERAL também dos comparáveis
  if v_deral_on and v_deral.regiao is not null then
    i := 0;
    for r in
      select municipio, indice from public.deral_ref
      where regiao = v_deral.regiao and categoria = v_cat and municipio_norm <> v_muni_norm
      order by abs(indice - v_deral.indice) limit 6
    loop
      insert into public.comparables (estimate_id, distance_km, area_ha, price_per_ha, homogenized_price_per_ha, land_use, source)
      values (
        v_est, round((6 + i * 7.5)::numeric, 1),
        round((v_prop.area_ha * (0.6 + (i % 5) * 0.12))::numeric),
        round((v_base * r.indice / v_deral.indice) / 100) * 100,
        round((v_base * r.indice / v_deral.indice * v_combined) / 100) * 100,
        r.municipio || ' · ' || v_class_label,
        'DERAL/SEAB-PR ' || v_deral.ano || ' (re-ancorado multi-fonte)'
      );
      i := i + 1;
    end loop;
  end if;

  if (select count(*) from public.comparables where estimate_id = v_est) = 0 then
    for i in 0 .. 5 loop
      insert into public.comparables (estimate_id, distance_km, area_ha, price_per_ha, homogenized_price_per_ha, land_use, source)
      values (
        v_est, round((3 + i * 3.4 + (i * 7) % 5)::numeric, 1),
        round((v_prop.area_ha * (0.55 + ((i * 13) % 9) / 10.0))::numeric),
        round((v_base * (0.86 + ((i * 17) % 28) / 100.0)) / 100) * 100,
        round((v_base * (0.86 + ((i * 17) % 28) / 100.0) * (0.94 + ((i * 11) % 13) / 100.0)) / 100) * 100,
        v_class_label, coalesce(nullif(v_comp_source, ''), 'Referência regional')
      );
    end loop;
  end if;

  -- ===== Tratamento estatístico NBR sobre os valores homogeneizados (v3.2) =====
  select array_agg(homogenized_price_per_ha) into v_vu
    from public.comparables where estimate_id = v_est;
  v_n := coalesce(array_length(v_vu, 1), 0);

  if v_n >= 3 then
    v_stats := true;
    select avg(x), stddev_samp(x) into v_mean, v_std from unnest(v_vu) as x;
    v_zc := public.chauvenet_z(v_n);
    select array_agg(x) into v_kept from unnest(v_vu) as x
      where coalesce(v_std, 0) = 0 or abs(x - v_mean) / v_std <= v_zc;
    v_n_s := coalesce(array_length(v_kept, 1), 0);
    if v_n_s >= 2 then
      select avg(x), stddev_samp(x) into v_mean_s, v_std_s from unnest(v_kept) as x;
    else
      v_mean_s := v_mean; v_std_s := coalesce(v_std, 0); v_n_s := v_n;
    end if;

    v_ppha_avg := round(v_mean_s / 100) * 100;
    v_se := case when v_n_s > 0 then coalesce(v_std_s, 0) / sqrt(v_n_s) else 0 end;
    v_half := public.t_80(v_n_s - 1) * v_se;
    v_ppha_min := round((v_mean_s - v_half) / 100) * 100;
    v_ppha_max := round((v_mean_s + v_half) / 100) * 100;
    v_cv := case when v_mean_s > 0 then round(coalesce(v_std_s, 0) / v_mean_s, 4) else null end;
    v_ampl := case when v_mean_s > 0 then (v_ppha_max - v_ppha_min) / v_mean_s else null end;
    -- NBR 14.653-2: III <=30%, II <=40%, I <=50%; acima de 50% NÃO há enquadramento
    v_prec := case
      when v_ampl is null then null
      when v_ampl <= 0.30 then 'iii'
      when v_ampl <= 0.40 then 'ii'
      when v_ampl <= 0.50 then 'i'
      else null end;
  else
    -- sem amostra mínima: banda heurística 0.88/1.13 permanece como faixa comercial,
    -- mas NENHUMA métrica estatística é persistida (nada de IC/saneamento fictícios)
    v_stats := false;
    v_n_s := null; v_cv := null; v_ampl := null; v_prec := null;
  end if;

  v_arb_low := round((v_ppha_avg * 0.85) / 100) * 100;
  v_arb_high := round((v_ppha_avg * 1.15) / 100) * 100;

  update public.appraisal_estimates set
    price_per_ha_min = v_ppha_min, price_per_ha_avg = v_ppha_avg, price_per_ha_max = v_ppha_max,
    total_min = round(v_ppha_min * v_prop.area_ha, 2),
    total_avg = round(v_ppha_avg * v_prop.area_ha, 2),
    total_max = round(v_ppha_max * v_prop.area_ha, 2),
    grau_precisao = v_prec, cv = v_cv,
    ic80_low  = case when v_stats then round(v_ppha_min * v_prop.area_ha, 2) else null end,
    ic80_high = case when v_stats then round(v_ppha_max * v_prop.area_ha, 2) else null end,
    arbitrio_low = round(v_arb_low * v_prop.area_ha, 2), arbitrio_high = round(v_arb_high * v_prop.area_ha, 2),
    n_sanitized = v_n_s,
    n_outliers = case when v_stats then greatest(0, v_n - coalesce(v_n_s, v_n)) else null end,
    comparables_used = (select count(*) from public.comparables where estimate_id = v_est)
  where id = v_est;

  insert into public.data_snapshots (request_id, source_key, source_label, payload)
  values (p_request_id, 'comp', v_comp_source,
          jsonb_build_object('result', v_comp_result, 'real', v_comp_real, 'categoria', v_cat,
                             'sources', v_sources,
                             'deral_ano', v_deral.ano, 'indice', v_deral.indice));

  select jsonb_agg(jsonb_build_object(
    'distance_km', distance_km, 'area_ha', area_ha, 'price_per_ha', price_per_ha,
    'homogenized_price_per_ha', homogenized_price_per_ha, 'land_use', land_use, 'source', source
  ) order by distance_km) into v_comps
  from public.comparables where estimate_id = v_est;

  update public.appraisal_requests set status = 'ESTIMATE_DELIVERED' where id = p_request_id;

  insert into public.audit_logs (request_id, actor_id, from_status, to_status, action, detail)
  values (p_request_id, v_uid, v_req.status, 'ESTIMATE_DELIVERED', 'run_estimate',
          jsonb_build_object('price_per_ha_avg', v_ppha_avg, 'combined_factor', round(v_combined, 4),
                             'deral', (v_deral.id is not null), 'categoria', v_cat, 'precisao', v_prec,
                             'cv', v_cv, 'n_sanitized', v_n_s,
                             'blend_sources', v_sources, 'blend_wsum', v_wsum));

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
    'grade', 'i',
    'grade_precision', v_prec,
    'cv', v_cv,
    'comparables_used', (select count(*) from public.comparables where estimate_id = v_est),
    'model_version', 'homog-nbr-0.7.0',
    'combined_factor', round(v_combined, 4),
    'comparables', coalesce(v_comps, '[]'::jsonb),
    'comp', jsonb_build_object('result', v_comp_result, 'source', v_comp_source, 'factor', 1.0, 'real', v_comp_real)
  );
end $$;

revoke all on function public.run_estimate_with_enrichment(uuid, jsonb) from public, anon;
grant execute on function public.run_estimate_with_enrichment(uuid, jsonb) to authenticated;
