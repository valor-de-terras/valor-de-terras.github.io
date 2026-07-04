-- "Spread da terra" (conceito confirmado por Alessandro/Avner 2026-07-03):
-- a terra como classe de ativo comparada a alternativas (CDI/IPCA/poupança).
-- get_spread(municipio) devolve a valorização NOMINAL histórica da terra na região
-- (série DERAL/SEAB-PR de preços de terras, categoria A) e a compara com taxas de
-- referência. Só percentuais (não o valor do imóvel); gating da Frente A intacto.

create table if not exists public.land_appreciation (
  municipio_norm text primary key,
  municipio text not null,
  regiao text,
  ano_ini_recente int not null,
  ano_fim int not null,
  cagr_recente numeric not null,   -- CAGR nominal da janela recente (~10 anos)
  ano_ini_longo int,
  cagr_longo numeric               -- CAGR nominal desde 1998
);
alter table public.land_appreciation enable row level security;  -- deny-all: só via RPC

-- taxas de referência (média do período recente; ajustáveis sem migration).
-- Fontes: CDI/Selic (BCB), IPCA (IBGE), poupança (BCB). Valores anualizados de
-- referência para o comparativo; não são projeção.
create table if not exists public.reference_rates (
  key text primary key,
  label text not null,
  rate numeric not null,
  fonte text
);
alter table public.reference_rates enable row level security;
insert into public.reference_rates (key, label, rate, fonte) values
  ('cdi',       'CDI (renda fixa)',        0.100, 'BCB - média anualizada ~2015-2024'),
  ('ipca',      'IPCA (inflação)',         0.055, 'IBGE - média anualizada ~2015-2024'),
  ('poupanca',  'Poupança',                0.060, 'BCB - média anualizada ~2015-2024')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_spread: valorização da terra na região vs alternativas. Não-monetário.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_spread(
  p_municipio text
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_norm text;
  v_la public.land_appreciation;
  v_cdi numeric;
  v_ipca numeric;
  v_pop numeric;
begin
  if coalesce(btrim(p_municipio), '') = '' then
    return jsonb_build_object('available', false);
  end if;
  v_norm := translate(upper(p_municipio),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC');
  v_norm := replace(replace(v_norm, '''', ''), '’', '');

  select * into v_la from public.land_appreciation where municipio_norm = v_norm;
  if v_la.municipio_norm is null then
    return jsonb_build_object('available', false);
  end if;

  select rate into v_cdi from public.reference_rates where key = 'cdi';
  select rate into v_ipca from public.reference_rates where key = 'ipca';
  select rate into v_pop from public.reference_rates where key = 'poupanca';

  return jsonb_build_object(
    'available', true,
    'municipio', v_la.municipio,
    'regiao', v_la.regiao,
    'cagr_recente', v_la.cagr_recente,
    'periodo_recente', v_la.ano_ini_recente || '-' || v_la.ano_fim,
    'cagr_longo', v_la.cagr_longo,
    'ano_ini_longo', v_la.ano_ini_longo,
    'ref', jsonb_build_object('cdi', v_cdi, 'ipca', v_ipca, 'poupanca', v_pop),
    'spread_vs_cdi', round(v_la.cagr_recente - coalesce(v_cdi, 0), 4),
    'spread_vs_ipca', round(v_la.cagr_recente - coalesce(v_ipca, 0), 4),
    'fonte', 'DERAL/SEAB-PR (série de preços de terras, categoria lavoura)',
    'nota', 'Valorização nominal do preço da terra na região; não inclui a renda produtiva (arrendamento típico 3-5% a.a.) nem custos/liquidez. Comparação de referência, não recomendação de investimento.'
  );
end $$;
revoke all on function public.get_spread(text) from public;
grant execute on function public.get_spread(text) to anon, authenticated;
