-- refresh_liquidity_stats falhava com HTTP 400 no fim de TODA coleta, pelo menos
-- desde 05/07/2026, sem nunca quebrar o scraper (o erro virava um "(aviso)").
-- Resultado: liquidity_stats congelada, silenciosamente desatualizada.
--
-- Causa: o Supabase carrega a extensao safeupdate na sessao do PostgREST, que
-- recusa DELETE sem WHERE com o erro 21000 "DELETE requires a WHERE clause".
-- O `delete from public.liquidity_stats;` da versao anterior era exatamente isso.
-- Como a funcao e' chamada via rpc/, ela herda essa protecao da sessao.
--
-- Correcao minima: `where true`. Satisfaz o safeupdate sem mudar a semantica e
-- sem desligar a protecao para o resto da sessao (que e' o que um
-- `set safeupdate.enabled = off` na funcao faria).
-- TRUNCATE tambem passaria, mas pega lock ACCESS EXCLUSIVE na tabela.

create or replace function public.refresh_liquidity_stats()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  perform public.mark_missing_listings();
  delete from public.liquidity_stats where true;
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
