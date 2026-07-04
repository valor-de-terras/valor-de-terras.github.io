-- Frente H (piloto, direcionamento Alessandro/Avner 2026-07-03): logística de
-- escoamento da cadeia de grãos. POIs logísticos (armazéns CONAB + porto de
-- Paranaguá) em PostGIS e RPC get_logistics(lon, lat): armazéns mais próximos,
-- capacidade de armazenagem num raio de 50 km, distância ao porto e um score de
-- acesso 0-100 com fórmula declarada. Saída 100% NÃO-monetária (fora do gating
-- da tarja da Frente A), padrão do get_liquidity.
--
-- Fonte dos POIs: cadastro público de armazéns da CONAB (CDA), extração 2023-11
-- (projeto FOMENTO ARENITO/IDR-Paraná); regenerável por
-- scrapers/conab_armazens_seed.py. Sem dados de contato (minimização LGPD).

create table if not exists public.logistics_pois (
  id bigserial primary key,
  kind text not null check (kind in ('armazem_conab', 'porto', 'frigorifico', 'laticinio', 'serraria')),
  ref_code text,
  name text not null,
  municipio text,
  uf text not null default 'PR',
  tipo text,
  cap_t integer check (cap_t is null or cap_t > 0),
  geom extensions.geometry(Point, 4326) not null,
  created_at timestamptz not null default now()
);
create unique index if not exists logistics_pois_uq
  on public.logistics_pois (kind, coalesce(ref_code, name || '|' || coalesce(municipio, '')));
-- índice funcional em geography: as consultas da RPC operam em geography
-- (st_distance/st_dwithin/<->); um gist em geometry ficaria sem uso
create index if not exists logistics_pois_geog_ix
  on public.logistics_pois using gist ((geom::extensions.geography));
alter table public.logistics_pois enable row level security;  -- deny-all: leitura só via RPC

-- ─────────────────────────────────────────────────────────────────────────────
-- get_logistics: consulta pública não-monetária por coordenada (centroide do
-- imóvel). Score 0-100 declarado:
--   proximidade (40 pts): 40 x max(0, 1 - dist_armazem_km/60)   [>=60 km -> 0]
--   densidade   (30 pts): 30 x min(1, cap_50km_t/500000)        [500 mil t = teto]
--   porto       (30 pts): 30 x max(0, 1 - dist_porto_km/600)    [600 km ~ extremo do PR]
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_logistics(
  p_lon numeric,
  p_lat numeric
) returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_pt extensions.geography;
  v_nearest jsonb;
  v_d1 numeric;
  v_cap50 numeric;
  v_n50 int;
  v_dport numeric;
  v_score numeric;
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

  return jsonb_build_object(
    'available', true,
    'score', v_score,
    'nearest', coalesce(v_nearest, '[]'::jsonb),
    'cap_50km_t', v_cap50,
    'n_50km', v_n50,
    'port_dist_km', v_dport,
    'port_name', 'Porto de Paranaguá',
    'fonte', 'CONAB (cadastro de armazéns/CDA), extração 2023-11',
    'formula', 'proximidade 40 + densidade 50km 30 + porto 30'
  );
end $$;

revoke all on function public.get_logistics(numeric, numeric) from public;
grant execute on function public.get_logistics(numeric, numeric) to anon, authenticated;
