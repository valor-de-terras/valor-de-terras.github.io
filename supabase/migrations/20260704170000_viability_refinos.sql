-- Refinos v2 do simulador de viabilidade (Frente H):
--  1. Preço de tora real na cadeia florestal (seed à parte substitui erva-mate).
--  2. Receita bruta potencial R$/ha por atividade (produtividade × preço).
--  3. Distância/tempo por ESTRADA (fator de sinuosidade sobre a linha reta) —
--     estimativa, não roteamento GPS turn-by-turn (pgRouting existe mas rotear
--     315k segmentos por requisição seria lento demais para uma RPC em tempo real).

-- ─────────────────────────────────────────────────────────────────────────────
-- produtividade de referência por atividade (unid/ha/ano). Valores documentados
-- (CONAB/IBGE PAM p/ grãos; referências de pastagem/silvicultura). Ajustáveis.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.chain_productivity (
  produto text primary key,
  cadeia text not null,
  produtividade numeric not null check (produtividade > 0),
  unidade text not null,
  fonte text
);
alter table public.chain_productivity enable row level security;
insert into public.chain_productivity (produto, cadeia, produtividade, unidade, fonte) values
  ('Soja industrial tipo 1', 'graos',     60,  'saca 60 kg/ha·ano',  'CONAB - produtividade média PR ~3,6 t/ha'),
  ('Milho amarelo tipo 1',   'graos',    110,  'saca 60 kg/ha·ano',  'CONAB - 1ª+2ª safra PR (referência)'),
  ('Trigo pão',              'graos',     45,  'saca 60 kg/ha·ano',  'CONAB - produtividade média PR ~2,7 t/ha'),
  ('Boi em pé',              'pecuaria',   5,  'arroba/ha·ano',      'pastagem manejada PR (referência)'),
  ('Vaca em pé',             'pecuaria',   5,  'arroba/ha·ano',      'pastagem manejada PR (referência)'),
  ('Leite',                  'leite',   4000,  'litro/ha·ano',       'pastagem leiteira PR (referência)'),
  ('Tora para processo',     'florestal', 32,  'm³/ha·ano',          'IMA eucalipto/pinus PR anualizado (referência)')
on conflict (produto) do update
  set produtividade = excluded.produtividade, unidade = excluded.unidade, fonte = excluded.fonte;

-- preço de referência do leite (não há cotação regional no SIMA) — DERAL/CEPEA.
insert into public.chain_prices (cadeia, produto, regional, unidade, preco, ref_month, fonte) values
  ('leite', 'Leite', 'PR (referência)', 'litro', 2.30, '2025-11', 'DERAL/CEPEA (referência estadual)')
on conflict (produto, regional) do nothing;

-- parâmetros de estrada (refino 3): fator de sinuosidade e velocidade média.
insert into public.freight_params (key, value, unit, fonte) values
  ('detour_factor', 1.35, 'x', 'sinuosidade rede rural (linha reta -> estrada, referência)'),
  ('speed_kmh',     55.0, 'km/h', 'velocidade média efetiva escoamento (referência)')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_viability v2: + receita bruta potencial R$/ha (produtividade × preço),
-- + distância/tempo por estrada. Escolhe o produto de MAIOR receita por cadeia.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_viability(
  p_lon numeric,
  p_lat numeric,
  p_municipio text default null
) returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_pt extensions.geography;
  v_norm text;
  v_zarc_apt numeric;
  v_regiao text;
  r record;
  v_items jsonb := '[]'::jsonb;
  v_dest_name text;
  v_dest_muni text;
  v_dist numeric;
  v_road numeric;
  v_min numeric;
  v_acesso numeric;
  v_aptidao numeric;
  v_score numeric;
  v_preco jsonb;
  v_receita numeric;
  v_detour numeric;
  v_speed numeric;
begin
  if p_lon is null or p_lat is null
     or p_lon < -180 or p_lon > 180 or p_lat < -90 or p_lat > 90 then
    raise exception 'Coordenada inválida';
  end if;
  v_pt := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;
  select value into v_detour from public.freight_params where key = 'detour_factor';
  select value into v_speed  from public.freight_params where key = 'speed_kmh';
  v_detour := coalesce(v_detour, 1.35);
  v_speed  := coalesce(v_speed, 55.0);

  if coalesce(btrim(p_municipio), '') <> '' then
    v_norm := translate(upper(p_municipio),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC');
    v_norm := replace(replace(v_norm, '''', ''), '’', '');
    select regiao into v_regiao from public.deral_ref
      where municipio_norm = v_norm and regiao is not null limit 1;
    select least(1.0, count(*) filter (where n_dec20 >= 5)::numeric / 4)
      into v_zarc_apt
    from public.zarc_summary where municipio_norm = v_norm;
  end if;

  for r in select * from public.chain_catalog loop
    select name, municipio,
           round((extensions.st_distance(geom::extensions.geography, v_pt) / 1000)::numeric, 1)
      into v_dest_name, v_dest_muni, v_dist
    from public.logistics_pois
    where kind = r.dest_kind
    order by geom::extensions.geography <-> v_pt
    limit 1;

    if v_dist is null then
      v_acesso := null; v_road := null; v_min := null;
    else
      v_road := round(v_dist * v_detour, 1);                 -- distância por estrada (estimada)
      v_min := round(v_road / v_speed * 60);                 -- tempo estimado (min)
      v_acesso := greatest(0, 1 - v_road / (r.dist_limit_km * v_detour));
    end if;

    if r.cadeia = 'graos' and v_zarc_apt is not null then
      v_aptidao := round(v_zarc_apt, 2);
    else
      v_aptidao := r.aptidao_base;
    end if;

    v_score := round(100 * coalesce(v_acesso, 0.35) * v_aptidao);

    -- produto da cadeia com MAIOR receita potencial (preço × produtividade) na
    -- regional; receita_ha bruta de referência. Sem produtividade cadastrada,
    -- cai no maior preço (comportamento anterior).
    select jsonb_build_object('produto', produto, 'preco', preco, 'unidade', unidade,
                              'ref_month', ref_month, 'regional', regional),
           case when prod is not null then round(preco * prod) else null end
      into v_preco, v_receita
    from (
      select cp.produto, cp.preco, cp.unidade, cp.ref_month, cp.regional, pr.produtividade as prod,
             coalesce(cp.preco * pr.produtividade, cp.preco) as ord
      from public.chain_prices cp
      left join public.chain_productivity pr on pr.produto = cp.produto
      where cp.cadeia = r.cadeia
      -- prefere a regional do município; senão a referência estadual; só então o
      -- global (evita mostrar o preço da região de maior valor como se fosse local)
      order by (cp.regional = v_regiao) desc, (cp.regional = 'PR (referência)') desc, ord desc
      limit 1
    ) best;

    v_items := v_items || jsonb_build_object(
      'cadeia', r.cadeia, 'label', r.label, 'score', v_score,
      'acesso', case when v_acesso is null then null else round(v_acesso * 100) end,
      'aptidao', round(v_aptidao * 100),
      'destino', v_dest_name, 'destino_municipio', v_dest_muni,
      'destino_km', v_dist, 'destino_estrada_km', v_road, 'destino_tempo_min', v_min,
      'preco', v_preco, 'receita_ha', v_receita, 'nota', r.nota
    );
  end loop;

  select jsonb_agg(e order by (e->>'score')::int desc) into v_items
  from jsonb_array_elements(v_items) e;

  return jsonb_build_object(
    'available', true,
    'atividades', coalesce(v_items, '[]'::jsonb),
    'regional', v_regiao,
    'criterio', 'score = acesso (por estrada estimada) × aptidão; receita_ha = produtividade × preço (bruta, referência)',
    'fonte', 'CONAB/frigoríficos/laticínios/indústria florestal · preços SIMA/SEAB-PR e Preços Florestais'
  );
end $$;
revoke all on function public.get_viability(numeric, numeric, text) from public;
grant execute on function public.get_viability(numeric, numeric, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_logistics v2: frete usa distância por ESTRADA (não linha reta); + tempo.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_logistics(
  p_lon numeric,
  p_lat numeric,
  p_municipio text default null
) returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_pt extensions.geography;
  v_nearest jsonb;
  v_d1 numeric;
  v_road numeric;
  v_min numeric;
  v_cap50 numeric;
  v_n50 int;
  v_dport numeric;
  v_score numeric;
  v_regiao text;
  v_norm text;
  v_frete_km numeric;
  v_peso_saca numeric;
  v_detour numeric;
  v_speed numeric;
  v_graos jsonb;
begin
  if p_lon is null or p_lat is null
     or p_lon < -180 or p_lon > 180 or p_lat < -90 or p_lat > 90 then
    raise exception 'Coordenada inválida';
  end if;
  v_pt := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;
  select value into v_detour from public.freight_params where key = 'detour_factor';
  select value into v_speed  from public.freight_params where key = 'speed_kmh';
  v_detour := coalesce(v_detour, 1.35);
  v_speed  := coalesce(v_speed, 55.0);

  select jsonb_agg(jsonb_build_object(
           'name', name, 'municipio', municipio, 'tipo', tipo,
           'cap_t', cap_t, 'dist_km', dist_km) order by dist_km),
         min(dist_km)
    into v_nearest, v_d1
  from (
    select name, municipio, tipo, cap_t,
           round((extensions.st_distance(geom::extensions.geography, v_pt) / 1000)::numeric, 1) as dist_km
    from public.logistics_pois
    where kind = 'armazem_conab'
    order by geom::extensions.geography <-> v_pt
    limit 3
  ) t;

  select coalesce(sum(cap_t), 0), count(*)
    into v_cap50, v_n50
  from public.logistics_pois
  where kind = 'armazem_conab'
    and extensions.st_dwithin(geom::extensions.geography, v_pt, 50000);

  select round((extensions.st_distance(geom::extensions.geography, v_pt) / 1000)::numeric, 0)
    into v_dport
  from public.logistics_pois where kind = 'porto'
  order by geom::extensions.geography <-> v_pt limit 1;

  if v_d1 is null then
    return jsonb_build_object('available', false);
  end if;

  v_road := round(v_d1 * v_detour, 1);
  v_min := round(v_road / v_speed * 60);

  v_score := round(
    40 * greatest(0, 1 - v_d1 / 60)
    + 30 * least(1, v_cap50 / 500000)
    + 30 * greatest(0, 1 - coalesce(v_dport, 600) / 600)
  );

  if coalesce(btrim(p_municipio), '') <> '' then
    v_norm := translate(upper(p_municipio),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC');
    v_norm := replace(replace(v_norm, '''', ''), '’', '');
    select regiao into v_regiao from public.deral_ref
      where municipio_norm = v_norm and regiao is not null limit 1;
  end if;
  select value into v_frete_km from public.freight_params where key = 'rod_graos_rt_km';
  select value into v_peso_saca from public.freight_params where key = 'peso_saca_t';

  -- frete até o armazém agora sobre a distância por ESTRADA (mais realista)
  select jsonb_agg(jsonb_build_object(
           'produto', produto, 'preco', preco, 'unidade', unidade,
           'regional', regional_usada, 'ref_month', ref_month,
           'frete_ate_armazem', frete_saca,
           'frete_pct', case when preco > 0 then round(100 * frete_saca / preco, 1) end)
         order by produto)
    into v_graos
  from (
    select produto,
           coalesce(max(preco) filter (where regional = v_regiao), round(avg(preco), 2)) as preco,
           max(unidade) as unidade, max(ref_month) as ref_month,
           case when bool_or(regional = v_regiao) then v_regiao else 'média PR' end as regional_usada,
           round((v_road * coalesce(v_frete_km, 0.25) * coalesce(v_peso_saca, 0.06))::numeric, 2) as frete_saca
    from public.chain_prices
    where cadeia = 'graos'
    group by produto
  ) g;

  return jsonb_build_object(
    'available', true,
    'score', v_score,
    'nearest', coalesce(v_nearest, '[]'::jsonb),
    'cap_50km_t', v_cap50, 'n_50km', v_n50,
    'port_dist_km', v_dport, 'port_name', 'Porto de Paranaguá',
    'armazem_estrada_km', v_road, 'armazem_tempo_min', v_min,
    'graos', coalesce(v_graos, '[]'::jsonb), 'graos_regional', v_regiao,
    'fonte', 'CONAB (cadastro de armazéns/CDA), extração 2023-11 · SIMA/SEAB-PR (preços)',
    'formula', 'proximidade 40 + densidade 50km 30 + porto 30; frete por estrada estimada'
  );
end $$;
revoke all on function public.get_logistics(numeric, numeric, text) from public;
grant execute on function public.get_logistics(numeric, numeric, text) to anon, authenticated;
