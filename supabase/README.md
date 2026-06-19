# Backend — Valor de Terras (Supabase)

Backend da plataforma implementado em **Postgres 16 + PostGIS** sobre Supabase, com
**Auth**, **Storage**, **Row-Level Security** e a API de fluxo exposta como **funções RPC**
(PostgREST) mais uma **Edge Function** de orquestração.

Reflete o modelo de domínio do plano, com a separação dura entre **estimativa automatizada**
(síncrona) e **laudo formal com ART** (assíncrono, responsabilidade técnica humana).

## Modelo de dados

| Tabela | Papel |
|--------|-------|
| `organizations` | Banco / cooperativa / escritório (multi-tenancy opcional) |
| `profiles` | Perfil do usuário (espelha `auth.users`), com `role` (client/technician/admin) |
| `technical_team_members` | Engenheiro avaliador (CREA, UF, especialidade) |
| `properties` | Imóvel avaliando: `geom` PostGIS, área, perímetro, centroide, CAR/SIGEF |
| `appraisal_requests` | Pedido de avaliação + `status` (máquina de estados) |
| `appraisal_estimates` | Estimativa preliminar (mín/méd/máx, fatores, grau NBR) |
| `comparables` | Comparáveis de mercado da estimativa |
| `appraisal_reports` | Laudo formal (responsável técnico, ART, narrativa, PDFs) |
| `data_snapshots` | Versão congelada de cada fonte externa (defensabilidade) |
| `audit_logs` | Trilha de mudanças de estado e edições |
| `enrichment_layers` | Catálogo das camadas de enriquecimento (referência) |
| `regional_base_prices` | Preços-base regionais (DERAL/CEPEA) do motor de estimativa |

## Máquina de estados (`appraisal_status`)

```
DRAFT → GEOMETRY_VALIDATING → DATA_ENRICHING → ESTIMATING → ESTIMATE_DELIVERED
  → (CANCELLED_BY_USER) | TECHNICAL_REVIEW_QUEUED → TECHNICAL_REVIEW_IN_PROGRESS
      → (NEEDS_MORE_INFO) | ART_PENDING → REPORT_GENERATING → DELIVERED
```

## API (RPC)

Chamáveis via `supabase.rpc(...)` com o JWT do usuário (RLS aplicada):

| Função | Descrição |
|--------|-----------|
| `create_appraisal_request(p_geojson, p_purpose, p_origin, p_car_code, p_municipality, p_uf)` | Cria `Property` (mede área/perímetro/centroide via PostGIS) e o pedido |
| `run_preliminary_estimate(p_request_id)` | Enriquecimento (stub) + homogeneização NBR + estimativa + comparáveis |
| `proceed_to_technical_review(p_request_id)` | Cliente solicita o laudo formal com ART |
| `cancel_request(p_request_id)` | Cancela o pedido |
| `assign_technical_review(p_request_id)` | Engenheiro assume a revisão (somente equipe técnica) |
| `submit_art_and_finish(p_request_id, p_art_number, p_narrative)` | Registra ART e finaliza o laudo |

Toda escrita acontece dentro de funções `SECURITY DEFINER` auditadas; o cliente não tem
`INSERT/UPDATE/DELETE` direto nas tabelas (apenas `SELECT` conforme RLS).

### Edge Function

`POST /functions/v1/appraise` — orquestra `create_appraisal_request` + `run_preliminary_estimate`
em uma chamada. Corpo: `{ geojson, purpose?, origin?, car_code?, municipality?, uf? }`.
É o ponto onde, na evolução, entram os conectores reais de dados abertos antes do motor NBR.

## Storage

Buckets privados: `geometries`, `art-pdfs`, `report-pdfs`. Acesso por dono do objeto;
equipe técnica lê os buckets de laudo/ART.

## Deploy

```bash
npx supabase login                 # uma vez (abre o navegador)
npx supabase link --project-ref <REF> -p <DB_PASSWORD>
npx supabase db push               # aplica as migrations
npx supabase functions deploy appraise
```

## Conectar o front-end

```ts
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// fluxo síncrono completo:
const { data } = await supabase.functions.invoke("appraise", {
  body: { geojson, uf: "PR", municipality: "Guarapuava" },
});
// ou direto via RPC:
const { data: reqId } = await supabase.rpc("create_appraisal_request", { p_geojson: geojson });
const { data: est } = await supabase.rpc("run_preliminary_estimate", { p_request_id: reqId });
```

> Os dados de enriquecimento e comparáveis ainda são sintéticos (stub), marcados como tais
> em `data_snapshots.payload.stub = true`. O laudo formal exige ART de profissional
> habilitado no CREA.
