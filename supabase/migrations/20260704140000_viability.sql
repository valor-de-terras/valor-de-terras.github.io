-- Frente H completa (mandato 2026-07-04): simulador de viabilidade por atividade.
-- Reframe do Avner: para o imóvel avaliado, quais atividades viabilizam o
-- investimento (grãos, pecuária de corte, leite, silvicultura). Para cada cadeia:
-- destino comprador mais próximo (armazém/frigorífico/laticínio/indústria florestal)
-- + score de acesso ao mercado + aptidão + preço regional de contexto -> ranking.
--
-- HONESTIDADE: o score é de ACESSO A MERCADO × APTIDÃO, não um R$/ha (que exigiria
-- produtividade calibrada por atividade — fica p/ v2). O preço regional é mostrado
-- como contexto (dado público de commodity), fora do gating da tarja.

-- catálogo de cadeias: kind do destino, limite de distância (perecibilidade/logística)
-- e peso de aptidão base (pastagem/floresta são mais tolerantes que grão a solo/declive).
create table if not exists public.chain_catalog (
  cadeia text primary key,
  label text not null,
  dest_kind text not null,
  dist_limit_km numeric not null,
  aptidao_base numeric not null check (aptidao_base between 0 and 1),
  nota text
);
alter table public.chain_catalog enable row level security;
insert into public.chain_catalog (cadeia, label, dest_kind, dist_limit_km, aptidao_base, nota) values
  ('graos',     'Grãos',               'armazem_conab', 80,  0.55, 'aptidão vem do ZARC do município'),
  ('pecuaria',  'Pecuária de corte',   'frigorifico',   320, 0.80, 'pastagem tolera solo/declive que grão não usa'),
  ('leite',     'Leite',               'laticinio',     90,  0.70, 'perecível: exige laticínio próximo'),
  ('florestal', 'Silvicultura/madeira','serraria',      160, 0.75, 'vai bem em terra de menor aptidão agrícola')
on conflict (cadeia) do update
  set label = excluded.label, dest_kind = excluded.dest_kind,
      dist_limit_km = excluded.dist_limit_km, aptidao_base = excluded.aptidao_base, nota = excluded.nota;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_viability: ranking de atividades para o imóvel (não-monetário no score;
-- preço regional só como contexto). Usa o centroide p/ distância ao destino e o
-- ZARC do município p/ aptidão de grãos.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_viability(
  p_lon numeric,
  p_lat numeric,
  p_municipio text default null
) returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_pt extensions.geography;
  v_norm text;
  v_zarc_apt numeric;          -- 0..1 aptidão de grãos derivada do ZARC
  v_regiao text;
  r record;
  v_items jsonb := '[]'::jsonb;
  v_dest_name text;
  v_dest_muni text;
  v_dist numeric;
  v_acesso numeric;
  v_aptidao numeric;
  v_score numeric;
  v_preco jsonb;
begin
  if p_lon is null or p_lat is null
     or p_lon < -180 or p_lon > 180 or p_lat < -90 or p_lat > 90 then
    raise exception 'Coordenada inválida';
  end if;
  v_pt := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;

  if coalesce(btrim(p_municipio), '') <> '' then
    v_norm := translate(upper(p_municipio),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC');
    v_norm := replace(replace(v_norm, '''', ''), '’', '');
    select regiao into v_regiao from public.deral_ref
      where municipio_norm = v_norm and regiao is not null limit 1;
    -- aptidão de grãos: fração de culturas com janela boa (>=5 decêndios a 20%),
    -- normalizada por 4 culturas de referência (soja/milho/trigo/feijão)
    select least(1.0, count(*) filter (where n_dec20 >= 5)::numeric / 4)
      into v_zarc_apt
    from public.zarc_summary where municipio_norm = v_norm;
  end if;

  for r in select * from public.chain_catalog loop
    -- destino comprador mais próximo da cadeia
    select name, municipio,
           round((extensions.st_distance(geom::extensions.geography, v_pt) / 1000)::numeric, 1)
      into v_dest_name, v_dest_muni, v_dist
    from public.logistics_pois
    where kind = r.dest_kind
    order by geom::extensions.geography <-> v_pt
    limit 1;

    if v_dist is null then
      -- sem cadastro de destino p/ essa cadeia: reporta aptidão, acesso desconhecido
      v_acesso := null;
    else
      v_acesso := greatest(0, 1 - v_dist / r.dist_limit_km);
    end if;

    -- aptidão: grãos usa ZARC quando disponível; demais usam a base do catálogo
    if r.cadeia = 'graos' and v_zarc_apt is not null then
      v_aptidao := round(v_zarc_apt, 2);
    else
      v_aptidao := r.aptidao_base;
    end if;

    -- score de viabilidade 0..100 = acesso × aptidão (acesso 0.35 quando destino
    -- desconhecido, p/ não zerar a cadeia só por falta de cadastro do comprador)
    v_score := round(100 * coalesce(v_acesso, 0.35) * v_aptidao);

    -- preço regional de contexto (melhor produto da cadeia na regional/estado)
    select jsonb_build_object('produto', produto, 'preco', preco, 'unidade', unidade,
                              'ref_month', ref_month)
      into v_preco
    from public.chain_prices
    where cadeia = r.cadeia
    order by (regional = v_regiao) desc, preco desc
    limit 1;

    v_items := v_items || jsonb_build_object(
      'cadeia', r.cadeia,
      'label', r.label,
      'score', v_score,
      'acesso', case when v_acesso is null then null else round(v_acesso * 100) end,
      'aptidao', round(v_aptidao * 100),
      'destino', v_dest_name,
      'destino_municipio', v_dest_muni,
      'destino_km', v_dist,
      'preco', v_preco,
      'nota', r.nota
    );
  end loop;

  -- ordena por score desc no SQL (jsonb_agg sobre subconsulta ordenada)
  select jsonb_agg(e order by (e->>'score')::int desc)
    into v_items
  from jsonb_array_elements(v_items) e;

  return jsonb_build_object(
    'available', true,
    'atividades', coalesce(v_items, '[]'::jsonb),
    'regional', v_regiao,
    'criterio', 'score = acesso ao comprador × aptidão; grãos usa ZARC do município',
    'fonte', 'CONAB/frigoríficos/laticínios/indústria florestal · preços SIMA/SEAB-PR'
  );
end $$;
revoke all on function public.get_viability(numeric, numeric, text) from public;
grant execute on function public.get_viability(numeric, numeric, text) to anon, authenticated;
