-- Frente B: base própria de comparáveis de mercado (raspagem de fontes públicas).
-- Fonte-piloto: CAIXA (listas CSV públicas por UF). Ver scrapers/caixa_imoveis.py.
-- Acesso restrito: SEM leitura anônima/authenticated (o valor é gated, ver Frente A);
-- escrita pelo scraper via service role; a estimativa lê via função SECURITY DEFINER.
--
-- Modelo (validado por pesquisa de fontes, notes/roadmap/):
--   market_listings   -> estado atual de cada anúncio (chave natural source+source_id)
--   listing_snapshots -> 1 linha por anúncio por dia (curva de sobrevivência/iliquidez)
--   scrape_runs       -> proveniência de cada coleta (reprodutibilidade / poder remover fonte)

create extension if not exists postgis;

-- ---------------------------------------------------------------------------
create table if not exists public.scrape_runs (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,
  uf           text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  n_rows       integer,
  notes        text
);
alter table public.scrape_runs enable row level security;

-- ---------------------------------------------------------------------------
create table if not exists public.market_listings (
  id                   uuid primary key default gen_random_uuid(),
  source               text not null,             -- 'caixa', 'mega_leiloes', 'mfrural', ...
  source_id            text not null,             -- chave natural (Nº do imóvel na CAIXA)
  url                  text,
  listing_kind         text,                      -- venda_direta | leilao_sfi | licitacao | venda_online | oferta
  price_basis          text,                      -- oferta | lance_leilao | arremataçao (NBR: oferta != transação)
  tipo_imovel          text,                      -- Terreno, Gleba, Casa, ...
  rural                boolean not null default false,
  uf                   text,
  municipio            text,
  municipio_norm       text,                      -- sem acento, minúsculo (join c/ deral_ref)
  ibge_municipio_code  text,                      -- 7 dígitos, chave canônica (join DERAL/IBGE/CAR)
  bairro               text,
  endereco             text,
  cep                  text,
  geom                 extensions.geometry(Point, 4326),  -- nulo até geocodificar (PostGIS em extensions)
  area_m2              numeric,
  area_ha              numeric,
  area_origin          text,                      -- csv_field | regex_descricao | ficha_detalhe
  preco                numeric,                   -- preço de venda / lance mínimo
  preco_1a_praca       numeric,                   -- leilão (nulo p/ CAIXA CSV)
  preco_2a_praca       numeric,
  preco_avaliacao      numeric,
  desconto_pct         numeric,
  preco_m2             numeric,
  matricula            text,
  cartorio             text,
  inscricao_imobiliaria text,
  financiamento        boolean,
  data_publicacao      date,                      -- nativo quando a fonte expõe
  data_leilao_1        date,
  data_leilao_2        date,
  content_hash         text,                      -- SHA de preço+área+status (detecta mudança)
  first_seen           timestamptz not null default now(),
  last_seen            timestamptz not null default now(),
  data_captura         timestamptz not null default now(),
  dias_ativo           integer not null default 0, -- iliquidez temporal (last_seen - first_seen)
  status               text not null default 'ativo', -- ativo | inativo (sumiu = provável venda)
  removed_at           timestamptz,
  payload_raw          jsonb,                      -- linha original (auditoria; NÃO exibir)
  unique (source, source_id)
);

create index if not exists market_listings_muni_idx   on public.market_listings (municipio_norm, uf);
create index if not exists market_listings_ibge_idx    on public.market_listings (ibge_municipio_code);
create index if not exists market_listings_rural_idx   on public.market_listings (rural) where rural;
create index if not exists market_listings_geom_idx    on public.market_listings using gist (geom extensions.gist_geometry_ops_2d);
create index if not exists market_listings_active_idx  on public.market_listings (status, first_seen);

-- Preserva first_seen no upsert e recalcula dias_ativo/last_seen (sinal de iliquidez).
create or replace function public.market_listings_touch()
returns trigger language plpgsql as $$
begin
  new.first_seen   := old.first_seen;                         -- nunca sobrescreve
  new.last_seen    := now();
  new.data_captura := now();
  new.dias_ativo   := greatest(0, (now()::date - old.first_seen::date));
  new.status       := 'ativo';
  new.removed_at   := null;
  return new;
end $$;

drop trigger if exists market_listings_touch_trg on public.market_listings;
create trigger market_listings_touch_trg
  before update on public.market_listings
  for each row execute function public.market_listings_touch();

alter table public.market_listings enable row level security;
-- sem policies => anon/authenticated negados. service role (scraper) e funções
-- SECURITY DEFINER (estimativa) acessam. Consistente com o gating da Frente A.

-- ---------------------------------------------------------------------------
-- 1 observação por anúncio por dia; base da curva de sobrevivência (iliquidez).
create table if not exists public.listing_snapshots (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,
  source_id     text not null,
  snapshot_date date not null,
  run_id        uuid references public.scrape_runs(id) on delete set null,
  preco         numeric,
  area_m2       numeric,
  content_hash  text,
  present       boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (source, source_id, snapshot_date)
);
create index if not exists listing_snapshots_key_idx on public.listing_snapshots (source, source_id);
alter table public.listing_snapshots enable row level security;

-- ---------------------------------------------------------------------------
-- Estatísticas de liquidez temporal por município + faixa de área (recalculadas em lote).
create table if not exists public.liquidity_stats (
  id               uuid primary key default gen_random_uuid(),
  source           text,
  uf               text,
  municipio_norm   text,
  rural            boolean,
  faixa_area       text,          -- '0-5ha', '5-20ha', '20-100ha', '100+ha', 'urbano'
  n                integer,
  mediana_dias     numeric,       -- iliquidez temporal
  taxa_inativos    numeric,       -- proporção que saiu do ar (proxy de venda)
  preco_m2_mediano numeric,
  updated_at       timestamptz not null default now(),
  unique (source, uf, municipio_norm, rural, faixa_area)
);
create index if not exists liquidity_stats_muni_idx on public.liquidity_stats (municipio_norm, uf);
alter table public.liquidity_stats enable row level security;
