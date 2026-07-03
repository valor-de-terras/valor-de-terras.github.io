-- Frente C: iliquidez temporal (tempo de anúncio) a partir de market_listings.
-- Exposto ao cliente APENAS o sinal de TEMPO (dias/meses para vender) e contagem -- nunca
-- preço (coerente com o gating da Frente A). É um indicador de mercado da região, não o
-- valor do imóvel.

-- Normalização de texto (sem acento, minúsculo) casando com o municipio_norm do scraper.
create or replace function public.norm_txt(p text)
returns text language sql immutable set search_path = public as $$
  select lower(translate(coalesce(trim(p), ''),
    'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç',
    'aaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuucc'));
$$;

-- Faixa de área (bin) para agregar liquidez.
create or replace function public.area_faixa(p_rural boolean, p_area_ha numeric)
returns text language sql immutable set search_path = public as $$
  select case
    when not coalesce(p_rural, false) then 'urbano'
    when p_area_ha is null then 'sem-area'
    when p_area_ha < 5   then '0-5ha'
    when p_area_ha < 20  then '5-20ha'
    when p_area_ha < 100 then '20-100ha'
    else '100+ha'
  end;
$$;

-- Recalcula a tabela agregada liquidity_stats (chamada pelo scraper após cada coleta).
create or replace function public.refresh_liquidity_stats()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  delete from public.liquidity_stats;
  insert into public.liquidity_stats
    (source, uf, municipio_norm, rural, faixa_area, n, mediana_dias, taxa_inativos, preco_m2_mediano, updated_at)
  select
    source, uf, municipio_norm, rural,
    public.area_faixa(rural, area_ha) as faixa_area,
    count(*),
    percentile_cont(0.5) within group (order by dias_ativo),
    round(avg(case when status = 'inativo' then 1.0 else 0.0 end), 4),
    percentile_cont(0.5) within group (order by preco_m2) filter (where preco_m2 is not null),
    now()
  from public.market_listings
  where municipio_norm is not null
  group by source, uf, municipio_norm, rural, public.area_faixa(rural, area_ha);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.refresh_liquidity_stats() from public, anon, authenticated;

-- Retorna o sinal de liquidez para o imóvel avaliando (só tempo/contagem, sem preço).
-- Faz fallback município+faixa -> UF+faixa -> UF+rural, e informa a maturidade da amostra
-- (max_dias) para o front distinguir "tempo típico" de "amostra em formação".
create or replace function public.get_liquidity(
  p_municipio text,
  p_uf text,
  p_area_ha numeric,
  p_rural boolean default true
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_muni text := public.norm_txt(p_municipio);
  v_uf   text := upper(coalesce(trim(p_uf), ''));
  v_faixa text := public.area_faixa(p_rural, p_area_ha);
  v jsonb;
begin
  -- 1) município + faixa
  select jsonb_build_object(
      'escopo', 'municipio', 'faixa_area', v_faixa, 'n', count(*),
      'mediana_dias', round(percentile_cont(0.5) within group (order by dias_ativo)),
      'max_dias', max(dias_ativo),
      'taxa_inativos', round(avg(case when status = 'inativo' then 1.0 else 0.0 end), 3))
    into v
  from public.market_listings
  where municipio_norm = v_muni and uf = v_uf and rural = p_rural
    and public.area_faixa(rural, area_ha) = v_faixa;
  if coalesce((v->>'n')::int, 0) >= 3 then return v; end if;

  -- 2) UF + faixa
  select jsonb_build_object(
      'escopo', 'uf', 'faixa_area', v_faixa, 'n', count(*),
      'mediana_dias', round(percentile_cont(0.5) within group (order by dias_ativo)),
      'max_dias', max(dias_ativo),
      'taxa_inativos', round(avg(case when status = 'inativo' then 1.0 else 0.0 end), 3))
    into v
  from public.market_listings
  where uf = v_uf and rural = p_rural and public.area_faixa(rural, area_ha) = v_faixa;
  if coalesce((v->>'n')::int, 0) >= 3 then return v; end if;

  -- 3) UF + rural (qualquer faixa)
  select jsonb_build_object(
      'escopo', 'uf_rural', 'faixa_area', 'todas', 'n', count(*),
      'mediana_dias', round(percentile_cont(0.5) within group (order by dias_ativo)),
      'max_dias', max(dias_ativo),
      'taxa_inativos', round(avg(case when status = 'inativo' then 1.0 else 0.0 end), 3))
    into v
  from public.market_listings
  where uf = v_uf and rural = p_rural;

  return coalesce(v, jsonb_build_object('escopo', 'vazio', 'n', 0));
end $$;
revoke all on function public.get_liquidity(text, text, numeric, boolean) from public;
grant execute on function public.get_liquidity(text, text, numeric, boolean) to anon, authenticated;
