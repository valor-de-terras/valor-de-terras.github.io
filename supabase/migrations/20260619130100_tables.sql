-- Valor de Terras — backend
-- 02 · Tabelas (modelo de domínio)

-- Organizações (banco, cooperativa, escritório) — multi-tenancy opcional
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Perfil do usuário (espelha auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  role public.app_role not null default 'client',
  organization_id uuid references public.organizations (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Engenheiro avaliador (responsável técnico / ART)
create table if not exists public.technical_team_members (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  crea_number text not null,
  uf text not null,
  specialty text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Imóvel avaliando (geometria PostGIS)
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  origin public.property_origin not null default 'geojson',
  geom extensions.geometry (MultiPolygon, 4326) not null,
  area_ha numeric(14, 4) not null default 0,
  perimeter_km numeric(14, 4) not null default 0,
  centroid extensions.geometry (Point, 4326),
  car_code text,
  sigef_code text,
  ccir_code text,
  municipality text,
  uf text,
  created_at timestamptz not null default now()
);
create index if not exists properties_geom_gix on public.properties using gist (geom);
create index if not exists properties_owner_ix on public.properties (owner_id);

-- Pedido de avaliação
create table if not exists public.appraisal_requests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  requester_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete set null,
  purpose public.appraisal_purpose not null default 'outro',
  status public.appraisal_status not null default 'DRAFT',
  technician_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists requests_requester_ix on public.appraisal_requests (requester_id);
create index if not exists requests_status_ix on public.appraisal_requests (status);
create index if not exists requests_technician_ix on public.appraisal_requests (technician_id);

-- Estimativa preliminar (valor mínimo / médio / máximo)
create table if not exists public.appraisal_estimates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.appraisal_requests (id) on delete cascade,
  price_per_ha_min numeric(14, 2),
  price_per_ha_avg numeric(14, 2),
  price_per_ha_max numeric(14, 2),
  total_min numeric(16, 2),
  total_avg numeric(16, 2),
  total_max numeric(16, 2),
  grade public.nbr_grade not null default 'normal',
  comparables_used int not null default 0,
  model_version text not null default 'homog-nbr-0.3.1',
  factors jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists estimates_request_ix on public.appraisal_estimates (request_id);

-- Comparáveis de mercado usados na estimativa
create table if not exists public.comparables (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.appraisal_estimates (id) on delete cascade,
  distance_km numeric(8, 2),
  area_ha numeric(14, 2),
  price_per_ha numeric(14, 2),
  homogenized_price_per_ha numeric(14, 2),
  land_use text,
  source text
);
create index if not exists comparables_estimate_ix on public.comparables (estimate_id);

-- Laudo formal (referencia o responsável técnico e a ART)
create table if not exists public.appraisal_reports (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.appraisal_requests (id) on delete cascade,
  technician_id uuid references public.profiles (id) on delete set null,
  art_number text,
  art_pdf_path text,
  report_pdf_path text,
  narrative text,
  manual_adjustments jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- DataSnapshot: versão congelada de cada fonte externa consultada (defensabilidade)
create table if not exists public.data_snapshots (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.appraisal_requests (id) on delete cascade,
  source_key text not null,
  source_label text,
  payload jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);
create index if not exists snapshots_request_ix on public.data_snapshots (request_id);

-- AuditLog: trilha completa de mudanças de estado e edições
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.appraisal_requests (id) on delete cascade,
  actor_id uuid default auth.uid() references auth.users (id) on delete set null,
  from_status public.appraisal_status,
  to_status public.appraisal_status,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_request_ix on public.audit_logs (request_id);

-- Catálogo de camadas de enriquecimento (referência, leitura pública)
create table if not exists public.enrichment_layers (
  key text primary key,
  label text not null,
  source text not null,
  factor numeric(6, 4) not null default 1.0,
  sort int not null default 0
);

-- Preços de referência regionais (DERAL/CEPEA), base do motor de estimativa
create table if not exists public.regional_base_prices (
  id uuid primary key default gen_random_uuid(),
  uf text not null,
  municipality text,
  base_price_per_ha numeric(14, 2) not null,
  source text,
  valid_from date not null default current_date,
  -- NULLS NOT DISTINCT (PG15+) garante unicidade também para o fallback estadual
  -- (municipality IS NULL) e faz o ON CONFLICT do seed funcionar nesse caso.
  unique nulls not distinct (uf, municipality)
);
