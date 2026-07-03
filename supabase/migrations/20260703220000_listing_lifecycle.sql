-- Fix (revisão 2026-07-03): o trigger market_listings_touch forçava status='ativo' e
-- removed_at=null em TODO update, tornando 'inativo' inalcançável -> taxa_inativos
-- sempre 0 e o sinal de iliquidez da Frente C morto. Além disso, nada marcava como
-- inativo os anúncios que somem da coleta. Este migration corrige os dois lados.

-- 1) Trigger respeita desativação explícita; upsert do scraper continua reativando.
create or replace function public.market_listings_touch()
returns trigger language plpgsql as $$
begin
  new.first_seen := old.first_seen;                             -- nunca sobrescreve
  -- só a TRANSIÇÃO explícita ativo->inativo congela; o upsert do scraper não envia
  -- status, então um anúncio que reaparece (update sem status) volta a ativo
  if new.status = 'inativo' and old.status is distinct from 'inativo' then
    -- desativação explícita (anúncio sumiu da coleta): congela o ciclo de vida
    new.last_seen    := old.last_seen;
    new.data_captura := old.data_captura;
    new.removed_at   := coalesce(new.removed_at, old.last_seen, now());
    new.dias_ativo   := greatest(0, (new.removed_at::date - old.first_seen::date));
  else
    -- visto de novo pelo scraper: volta a ativo e atualiza o relógio
    new.last_seen    := now();
    new.data_captura := now();
    new.dias_ativo   := greatest(0, (now()::date - old.first_seen::date));
    new.status       := 'ativo';
    new.removed_at   := null;
  end if;
  return new;
end $$;

-- 2) Marca como inativo o que não apareceu na coleta mais recente da mesma fonte.
--    Chamado dentro de refresh_liquidity_stats (que o scraper já invoca ao final).
create or replace function public.mark_missing_listings()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update public.market_listings ml
     set status = 'inativo',
         removed_at = ml.last_seen
   where ml.status = 'ativo'
     and ml.last_seen::date < (
       select max(m2.last_seen)::date from public.market_listings m2
        where m2.source = ml.source
     );
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.mark_missing_listings() from public, anon, authenticated;

-- 3) refresh_liquidity_stats passa a marcar sumidos antes de agregar.
create or replace function public.refresh_liquidity_stats()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  perform public.mark_missing_listings();
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
