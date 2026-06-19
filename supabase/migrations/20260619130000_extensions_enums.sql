-- Valor de Terras — backend (Supabase / Postgres + PostGIS)
-- 01 · Extensões e tipos de domínio (enums)
-- Modelo de domínio espelha o plano: separação dura entre estimativa automatizada
-- (síncrona) e laudo formal com ART (assíncrono, responsabilidade técnica humana).

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Papel do usuário na plataforma
do $$ begin
  create type public.app_role as enum ('client', 'technician', 'admin');
exception when duplicate_object then null; end $$;

-- Origem da geometria do imóvel
do $$ begin
  create type public.property_origin as enum ('kml', 'kmz', 'shp', 'geojson', 'car', 'point');
exception when duplicate_object then null; end $$;

-- Finalidade da avaliação
do $$ begin
  create type public.appraisal_purpose as enum (
    'garantia_bancaria', 'partilha', 'venda', 'judicial', 'itr', 'arrendamento', 'cpr', 'outro'
  );
exception when duplicate_object then null; end $$;

-- Grau de fundamentação NBR 14.653
do $$ begin
  create type public.nbr_grade as enum ('expedito', 'normal', 'rigoroso');
exception when duplicate_object then null; end $$;

-- Máquina de estados do pedido de avaliação (do plano)
do $$ begin
  create type public.appraisal_status as enum (
    'DRAFT',
    'GEOMETRY_VALIDATING',
    'GEOMETRY_REJECTED',
    'DATA_ENRICHING',
    'ENRICHMENT_FAILED',
    'ESTIMATING',
    'ESTIMATE_DELIVERED',
    'CANCELLED_BY_USER',
    'TECHNICAL_REVIEW_QUEUED',
    'TECHNICAL_REVIEW_IN_PROGRESS',
    'NEEDS_MORE_INFO',
    'ART_PENDING',
    'REPORT_GENERATING',
    'DELIVERED'
  );
exception when duplicate_object then null; end $$;
