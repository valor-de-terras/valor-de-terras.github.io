-- Frentes I, J, K + ext. D + H v2 (mandato 2026-07-04: implantar todas as frentes).
-- Sinais NÃO-monetários por coordenada/município, padrão get_liquidity/get_logistics:
--   J: outorgas de água (SIGARH/IAT) e processos minerários (ANM/SIGMINE) -> get_outorgas
--   I: aptidão climática ZARC (Tábua de Risco/MAPA) -> get_zarc
--   K: screening de restrições (UCs CNUC, TIs FUNAI, embargos IBAMA) + perímetro
--      urbano (ext. Frente D) -> get_compliance
--   H v2: preço regional da cadeia (SIMA/SEAB via Datageo) + frete estimado até o
--      armazém -> get_logistics(p_municipio) — preço de commodity é dado público de
--      mercado, não o valor do imóvel (gating da Frente A preservado).
-- Todas as tabelas: RLS deny-all; leitura só via RPC SECURITY DEFINER.

-- ─────────────────────────────────────────────────────────────────────────────
-- J · outorgas (água = pontos SIGARH; mineração = polígonos SIGMINE)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.outorgas (
  id bigserial primary key,
  kind text not null check (kind in ('agua', 'mineracao')),
  tipo text,
  doc text,
  uso text,
  finalidade text,
  municipio text,
  detalhe text,
  ref_doc text,
  vazao_m3h numeric,
  area_ha numeric,
  geom extensions.geometry(Geometry, 4326) not null,
  created_at timestamptz not null default now()
);
create index if not exists outorgas_geom_ix
  on public.outorgas using gist (geom extensions.gist_geometry_ops_2d);
create index if not exists outorgas_geog_ix
  on public.outorgas using gist ((geom::extensions.geography));
create index if not exists outorgas_kind_ix on public.outorgas (kind);
alter table public.outorgas enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- I · resumo ZARC por município x cultura (melhor caso sequeiro)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.zarc_summary (
  id bigserial primary key,
  cod_ibge text not null,
  municipio_norm text not null,
  municipio text not null,
  cultura text not null,
  safra text not null,
  portaria text,
  n_dec20 int not null,
  n_dec_ok int not null,
  janela text,
  unique (cod_ibge, cultura, safra)
);
create index if not exists zarc_summary_muni_ix on public.zarc_summary (municipio_norm);
alter table public.zarc_summary enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- H v2 · preços regionais por cadeia (SIMA/SEAB) + parâmetros de frete
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.chain_prices (
  id bigserial primary key,
  cadeia text not null,
  produto text not null,
  regional text not null,
  unidade text not null,
  preco numeric not null check (preco > 0),
  ref_month text not null,
  fonte text not null,
  unique (produto, regional)
);
alter table public.chain_prices enable row level security;

create table if not exists public.freight_params (
  key text primary key,
  value numeric not null,
  unit text not null,
  fonte text
);
alter table public.freight_params enable row level security;
insert into public.freight_params (key, value, unit, fonte) values
  ('rod_graos_rt_km', 0.25, 'R$/t/km', 'parâmetro inicial (calibrar com SIFRECA/ESALQ-LOG)'),
  ('peso_saca_t', 0.06, 't/saca 60 kg', 'constante')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- ext. D · perímetros urbanos municipais (classificador rural x urbano)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.urban_perimeters (
  id bigserial primary key,
  cod text,
  nome text,
  lei text,
  cod_ibge text,
  municipio text,
  area_ha numeric,
  geom extensions.geometry(MultiPolygon, 4326) not null
);
create index if not exists urban_perimeters_geom_ix
  on public.urban_perimeters using gist (geom extensions.gist_geometry_ops_2d);
alter table public.urban_perimeters enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- K · áreas com restrição (UC, TI, embargo IBAMA) — screening, não demarcação
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.restricted_areas (
  id bigserial primary key,
  kind text not null check (kind in ('uc', 'ti', 'embargo')),
  nome text,
  categoria text,
  detalhe text,
  ref_doc text,
  area_ha numeric,
  geom extensions.geometry(MultiPolygon, 4326) not null
);
create index if not exists restricted_areas_geom_ix
  on public.restricted_areas using gist (geom extensions.gist_geometry_ops_2d);
create index if not exists restricted_areas_geog_ix
  on public.restricted_areas using gist ((geom::extensions.geography));
create index if not exists restricted_areas_kind_ix on public.restricted_areas (kind);
alter table public.restricted_areas enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- helper: geometria do imóvel a partir de (lon, lat) + geojson opcional
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._signal_geom(p_lon numeric, p_lat numeric, p_geojson jsonb)
returns extensions.geometry language plpgsql immutable set search_path = public, extensions as $$
declare
  v extensions.geometry;
begin
  if p_lon is null or p_lat is null
     or p_lon < -180 or p_lon > 180 or p_lat < -90 or p_lat > 90 then
    raise exception 'Coordenada inválida';
  end if;
  if p_geojson is not null then
    begin
      v := extensions.st_setsrid(extensions.st_geomfromgeojson(p_geojson::text), 4326);
      if extensions.st_isvalid(v) and not extensions.st_isempty(v)
         and extensions.st_area(v::extensions.geography) < 5e9 then
        return v;
      end if;
    exception when others then
      null; -- geojson ruim: cai no ponto
    end;
  end if;
  return extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326);
end $$;
revoke all on function public._signal_geom(numeric, numeric, jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- J · get_outorgas: água (raio 2 km) + mineração (intersecção e raio 2 km)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_outorgas(
  p_lon numeric,
  p_lat numeric,
  p_geojson jsonb default null
) returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_geom extensions.geometry := public._signal_geom(p_lon, p_lat, p_geojson);
  v_geog extensions.geography := v_geom::extensions.geography;
  v_agua jsonb;
  v_min_hits jsonb;
  v_min_n2 int;
begin
  select jsonb_build_object(
    'n_2km', count(*),
    'vazao_m3h_2km', round(coalesce(sum(vazao_m3h), 0)::numeric, 1),
    'nearest_km', round(min(extensions.st_distance(geom::extensions.geography, v_geog) / 1000)::numeric, 2),
    'tipos', (
      select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'n', n) order by n desc), '[]'::jsonb)
      from (
        select tipo, count(*) as n from public.outorgas
        where kind = 'agua' and extensions.st_dwithin(geom::extensions.geography, v_geog, 2000)
        group by tipo order by count(*) desc limit 4
      ) tt
    )
  ) into v_agua
  from public.outorgas
  where kind = 'agua' and extensions.st_dwithin(geom::extensions.geography, v_geog, 2000);

  select coalesce(jsonb_agg(jsonb_build_object(
           'fase', tipo, 'substancia', finalidade, 'uso', uso,
           'processo', ref_doc, 'area_ha', area_ha)), '[]'::jsonb)
    into v_min_hits
  from (
    select tipo, finalidade, uso, ref_doc, area_ha
    from public.outorgas
    where kind = 'mineracao' and extensions.st_intersects(geom, v_geom)
    order by area_ha desc nulls last limit 5
  ) m;

  select count(*) into v_min_n2
  from public.outorgas
  where kind = 'mineracao' and extensions.st_dwithin(geom::extensions.geography, v_geog, 2000);

  return jsonb_build_object(
    'available', true,
    'agua', coalesce(v_agua, jsonb_build_object('n_2km', 0)),
    'mineracao', jsonb_build_object(
      'n_intersecta', coalesce(jsonb_array_length(v_min_hits), 0),
      'processos', v_min_hits,
      'n_2km', v_min_n2),
    'fontes', 'SIGARH/IAT-PR (água) · ANM/SIGMINE (mineração, base diária)'
  );
end $$;
revoke all on function public.get_outorgas(numeric, numeric, jsonb) from public;
grant execute on function public.get_outorgas(numeric, numeric, jsonb) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- I · get_zarc: aptidão climática por município (melhor caso sequeiro)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_zarc(
  p_municipio text,
  p_uf text default 'PR'
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_norm text;
  v_out jsonb;
begin
  if coalesce(btrim(p_municipio), '') = '' then
    return jsonb_build_object('available', false);
  end if;
  v_norm := translate(upper(p_municipio),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC');
  v_norm := replace(replace(v_norm, '''', ''), '’', '');

  select jsonb_agg(jsonb_build_object(
           'cultura', cultura, 'n_dec20', n_dec20, 'n_dec_ok', n_dec_ok,
           'janela', janela, 'safra', safra, 'portaria', portaria)
         order by n_dec20 desc, cultura)
    into v_out
  from public.zarc_summary
  where municipio_norm = v_norm;

  if v_out is null then
    return jsonb_build_object('available', false);
  end if;
  return jsonb_build_object(
    'available', true,
    'culturas', v_out,
    'criterio', 'melhor combinação solo/ciclo, sequeiro; decêndios com risco 20%',
    'fonte', 'ZARC/MAPA (Tábua de Risco, dados abertos)'
  );
end $$;
revoke all on function public.get_zarc(text, text) from public;
grant execute on function public.get_zarc(text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- K + ext. D · get_compliance: restrições que intersectam/vizinhas + perímetro urbano
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_compliance(
  p_lon numeric,
  p_lat numeric,
  p_geojson jsonb default null
) returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_geom extensions.geometry := public._signal_geom(p_lon, p_lat, p_geojson);
  v_geog extensions.geography := v_geom::extensions.geography;
  v_hits jsonb;
  v_near jsonb;
  v_urb jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', kind, 'nome', nome, 'categoria', categoria, 'detalhe', detalhe)), '[]'::jsonb)
    into v_hits
  from (
    select kind, nome, categoria, detalhe
    from public.restricted_areas
    where extensions.st_intersects(geom, v_geom)
    order by kind limit 10
  ) h;

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', kind, 'nome', nome, 'categoria', categoria, 'dist_km', dist_km)), '[]'::jsonb)
    into v_near
  from (
    select kind, nome, categoria,
           round((extensions.st_distance(geom::extensions.geography, v_geog) / 1000)::numeric, 1) as dist_km
    from public.restricted_areas
    where not extensions.st_intersects(geom, v_geom)
      and extensions.st_dwithin(geom::extensions.geography, v_geog, 2000)
    order by geom::extensions.geography <-> v_geog limit 5
  ) n;

  select jsonb_build_object('dentro', true, 'perimetro', nome, 'municipio', municipio, 'lei', lei)
    into v_urb
  from public.urban_perimeters
  where extensions.st_intersects(geom, v_geom)
  limit 1;

  return jsonb_build_object(
    'available', true,
    'intersecta', v_hits,
    'proximas_2km', v_near,
    'urbano', coalesce(v_urb, jsonb_build_object('dentro', false)),
    'fontes', 'CNUC/MMA 2026-03 · FUNAI/CMR · embargos IBAMA 2026-02 · perímetros urbanos PR',
    'nota', 'Screening preliminar por sobreposição geométrica; não substitui certidões e consulta aos órgãos.'
  );
end $$;
revoke all on function public.get_compliance(numeric, numeric, jsonb) from public;
grant execute on function public.get_compliance(numeric, numeric, jsonb) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- H v2 · get_logistics ganha p_municipio: preço regional da cadeia (SIMA) +
-- frete estimado até o armazém mais próximo. Assinatura antiga é removida para
-- não criar sobrecarga ambígua (o front chama por nome com named params).
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_logistics(numeric, numeric);

create or replace function public.get_logistics(
  p_lon numeric,
  p_lat numeric,
  p_municipio text default null
) returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_pt extensions.geography;
  v_nearest jsonb;
  v_d1 numeric;
  v_cap50 numeric;
  v_n50 int;
  v_dport numeric;
  v_score numeric;
  v_regiao text;
  v_norm text;
  v_frete_km numeric;
  v_peso_saca numeric;
  v_graos jsonb;
begin
  if p_lon is null or p_lat is null
     or p_lon < -180 or p_lon > 180 or p_lat < -90 or p_lat > 90 then
    raise exception 'Coordenada inválida';
  end if;
  v_pt := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;

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
  from public.logistics_pois
  where kind = 'porto'
  order by geom::extensions.geography <-> v_pt
  limit 1;

  if v_d1 is null then
    return jsonb_build_object('available', false);
  end if;

  v_score := round(
    40 * greatest(0, 1 - v_d1 / 60)
    + 30 * least(1, v_cap50 / 500000)
    + 30 * greatest(0, 1 - coalesce(v_dport, 600) / 600)
  );

  -- H v2: economia da cadeia de grãos na regional do município (preço público SIMA)
  if coalesce(btrim(p_municipio), '') <> '' then
    v_norm := translate(upper(p_municipio),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC');
    v_norm := replace(replace(v_norm, '''', ''), '’', '');
    select regiao into v_regiao from public.deral_ref
      where municipio_norm = v_norm and regiao is not null limit 1;
  end if;
  select value into v_frete_km from public.freight_params where key = 'rod_graos_rt_km';
  select value into v_peso_saca from public.freight_params where key = 'peso_saca_t';

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
           max(unidade) as unidade,
           max(ref_month) as ref_month,
           case when bool_or(regional = v_regiao) then v_regiao else 'média PR' end as regional_usada,
           round((v_d1 * coalesce(v_frete_km, 0.25) * coalesce(v_peso_saca, 0.06))::numeric, 2) as frete_saca
    from public.chain_prices
    where cadeia = 'graos'
    group by produto
  ) g;

  return jsonb_build_object(
    'available', true,
    'score', v_score,
    'nearest', coalesce(v_nearest, '[]'::jsonb),
    'cap_50km_t', v_cap50,
    'n_50km', v_n50,
    'port_dist_km', v_dport,
    'port_name', 'Porto de Paranaguá',
    'graos', coalesce(v_graos, '[]'::jsonb),
    'graos_regional', v_regiao,
    'fonte', 'CONAB (cadastro de armazéns/CDA), extração 2023-11 · SIMA/SEAB-PR (preços)',
    'formula', 'proximidade 40 + densidade 50km 30 + porto 30'
  );
end $$;
revoke all on function public.get_logistics(numeric, numeric, text) from public;
grant execute on function public.get_logistics(numeric, numeric, text) to anon, authenticated;
