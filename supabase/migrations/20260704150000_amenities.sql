-- Frente L (pontos de atração; adiada pelo Avner, agora implantada). Atributos de
-- atratividade locacional que a NBR 14.653 admite no campo de arbítrio (até +15%):
-- proximidade a atrativos turísticos/cênicos e a centros urbanos (serviços).
-- get_amenities(lon,lat) devolve distâncias/contagens + um FATOR SUGERIDO 0..0.15;
-- a aplicação é decisão do responsável técnico (aparece no laudo, seção 8.6).
-- Saída não expõe valor do imóvel (só distâncias/contagens/percentual).

create table if not exists public.amenity_pois (
  id bigserial primary key,
  kind text not null check (kind in ('cenico', 'turistico', 'cidade', 'vila')),
  nome text not null,
  tipo text,
  municipio text,
  populacao int,
  geom extensions.geometry(Point, 4326) not null
);
create index if not exists amenity_pois_geog_ix
  on public.amenity_pois using gist ((geom::extensions.geography));
create index if not exists amenity_pois_kind_ix on public.amenity_pois (kind);
alter table public.amenity_pois enable row level security;  -- deny-all: só via RPC

create or replace function public.get_amenities(
  p_lon numeric,
  p_lat numeric
) returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_pt extensions.geography;
  v_cidade jsonb;
  v_dcidade numeric;
  v_dcenico numeric;
  v_destaques jsonb;
  v_n15 int;
  f_cenico numeric;
  f_cidade numeric;
  f_dens numeric;
  v_fator numeric;
begin
  if p_lon is null or p_lat is null
     or p_lon < -180 or p_lon > 180 or p_lat < -90 or p_lat > 90 then
    raise exception 'Coordenada inválida';
  end if;
  v_pt := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;

  -- cidade-polo mais próxima (place=city)
  select jsonb_build_object('nome', nome, 'dist_km', dist_km), dist_km
    into v_cidade, v_dcidade
  from (
    select nome, round((extensions.st_distance(geom::extensions.geography, v_pt) / 1000)::numeric, 0) as dist_km
    from public.amenity_pois where kind = 'cidade'
    order by geom::extensions.geography <-> v_pt limit 1
  ) c;

  -- atrativo cênico mais próximo (query dedicada; não restrita aos top-5 mistos)
  select round((extensions.st_distance(geom::extensions.geography, v_pt) / 1000)::numeric, 1)
    into v_dcenico
  from public.amenity_pois where kind = 'cenico'
  order by geom::extensions.geography <-> v_pt limit 1;

  -- destaques: cênico/turístico mais próximos em 15 km
  select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'tipo', tipo, 'kind', kind, 'dist_km', dist_km)
           order by dist_km), '[]'::jsonb)
    into v_destaques
  from (
    select nome, tipo, kind,
           round((extensions.st_distance(geom::extensions.geography, v_pt) / 1000)::numeric, 1) as dist_km
    from public.amenity_pois
    where kind in ('cenico', 'turistico')
      and extensions.st_dwithin(geom::extensions.geography, v_pt, 15000)
    order by geom::extensions.geography <-> v_pt limit 5
  ) d;

  select count(*) into v_n15
  from public.amenity_pois
  where kind in ('cenico', 'turistico')
    and extensions.st_dwithin(geom::extensions.geography, v_pt, 15000);

  -- fator locacional (ABNT, campo de arbítrio até +15%):
  --   cênico   até +8%  (atrativo cênico dentro de 15 km)
  --   cidade   até +4%  (centro urbano/serviços dentro de 60 km)
  --   densidade até +3% (concentração de atrativos em 15 km)
  f_cenico := 0.08 * greatest(0, 1 - coalesce(v_dcenico, 999) / 15);
  f_cidade := 0.04 * greatest(0, 1 - coalesce(v_dcidade, 999) / 60);
  f_dens := 0.03 * least(1, v_n15 / 8.0);
  v_fator := round(least(0.15, f_cenico + f_cidade + f_dens), 3);

  return jsonb_build_object(
    'available', true,
    'cidade_polo', case when v_cidade is not null
      then (v_cidade->>'nome') || ' (' || (v_cidade->>'dist_km') || ' km)' else null end,
    'cenico_km', v_dcenico,
    'n_atrativos_15km', v_n15,
    'destaques', v_destaques,
    'fator_sugerido', v_fator,
    'fonte', 'OpenStreetMap (atrativos turísticos/cênicos e centros urbanos)',
    'nota', 'Fator de valorização locacional sugerido no campo de arbítrio da NBR 14.653; aplicação é decisão do responsável técnico.'
  );
end $$;
revoke all on function public.get_amenities(numeric, numeric) from public;
grant execute on function public.get_amenities(numeric, numeric) to anon, authenticated;
