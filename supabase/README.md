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
| `proceed_to_technical_review(p_request_id, p_contact_name, p_contact_email, p_contact_phone, p_purpose)` | Cliente solicita o laudo e deixa contato (consentimento LGPD) |
| `save_technical_review(p_request_id, p_narrative, p_grade, p_final_price_per_ha, p_final_total, p_adjustments)` | Rascunho da revisão (só o engenheiro responsável; não muda o status) |
| `submit_art_and_finish(p_request_id, p_art_number, p_narrative, p_art_pdf_path, p_grade, p_final_price_per_ha, p_final_total)` | Registra ART e move para `REPORT_GENERATING` (trava: mesmo engenheiro, CREA válido, ART obrigatória) |
| `finalize_report_delivery(p_request_id, p_report_pdf_path)` | Grava o caminho do PDF e finaliza em `DELIVERED` (chamada pela edge function) |
| `get_technician_queue()` | Fila do painel (só equipe técnica): pedidos em fila/revisão/gerando |
| `get_request_bundle(p_request_id)` | Pacote completo do pedido (imóvel+geometria, estimativa, comparáveis, enriquecimento, laudo, auditoria) para painel/PDF/acompanhamento |
| `get_my_requests()` | Pedidos do solicitante logado (para acompanhar status/laudo) |
| `admin_upsert_technician(p_email, p_crea, p_uf, p_specialty, p_valid_months)` | Onboarding: promove um usuário existente a técnico (somente admin) |

Toda escrita acontece dentro de funções `SECURITY DEFINER` auditadas; o cliente não tem
`INSERT/UPDATE/DELETE` direto nas tabelas (apenas `SELECT` conforme RLS).

### Edge Functions

| Função | Descrição |
|--------|-----------|
| `POST /functions/v1/appraise` | Orquestra `create_appraisal_request` + `run_estimate_with_enrichment` (conectores reais de dados abertos + motor NBR) em uma chamada. Corpo: `{ geojson, purpose?, origin?, car_code?, municipality?, uf? }` |
| `POST /functions/v1/generate-report` | Gera o PDF do laudo NBR 14.653-3 (pdf-lib) com o JWT do engenheiro responsável, grava no bucket privado `report-pdfs` e finaliza o pedido. Corpo: `{ request_id }` |
| `POST /functions/v1/report-link` | Devolve URL assinada (1h) do PDF; verifica o escopo pelo JWT antes de assinar via service role. Corpo: `{ request_id }` |

## Storage

Buckets privados: `geometries`, `art-pdfs`, `report-pdfs`. Acesso por dono do objeto;
equipe técnica lê os buckets de laudo/ART.

## Painel do engenheiro e onboarding da equipe técnica

O painel fica em `/#/portal` (rota discreta, protegida por login, não linkada na landing).
Engenheiros entram com **e-mail + senha** (contas pré-criadas por um admin — não há
autocadastro público). O cliente continua usando **login anônimo** para a estimativa.

**Bootstrap (uma vez, pelo dono do projeto).** Como `[auth.email] enable_confirmations = true`
e não há SMTP configurado, crie as contas já confirmadas pelo Dashboard e promova por SQL:

1. **Supabase Dashboard → Authentication → Users → Add user**: informe e-mail + senha e marque
   **Auto Confirm User**. Repita para cada engenheiro (ex.: Avner, sócio).
2. **SQL Editor**, uma vez, para cada engenheiro (bootstrap direto, pois `admin_upsert_technician`
   exige um admin já existente):

   ```sql
   -- promove o perfil a técnico
   update public.profiles set role = 'technician' where email = 'engenheiro@exemplo.com';
   -- registra o responsável técnico com CREA válido (validade anual)
   insert into public.technical_team_members
     (profile_id, crea_number, uf, specialty, active, crea_active, crea_valid_until)
   values ((select id from public.profiles where email = 'engenheiro@exemplo.com'),
           'PR-12345/D', 'PR', 'Eng. Florestal', true, true, current_date + interval '12 months')
   on conflict (profile_id) do update
     set crea_active = true, active = true, crea_valid_until = current_date + interval '12 months';
   ```

3. **Promova um deles a `admin`** (uma vez, por SQL) para habilitar o painel de gestão:
   `update public.profiles set role='admin' where email='avner@exemplo.com';`

**Depois disso, sem SQL.** Logado como admin, o portal ganha a aba **"Equipe"**, onde se
cadastra novos engenheiros (nome, e-mail, senha temporária, CREA, UF, validade), renova a
validade do CREA e ativa/desativa. A criação da conta (já confirmada) roda na edge function
`admin-create-technician` (service role, após checar `is_admin`); o engenheiro entra em
`/#/portal` com a senha temporária e a troca em **"Trocar senha"**. Só o **primeiro admin**
precisa do SQL acima.

> A trava da ART exige `crea_valid_until >= current_date`. O painel renova a validade a cada
> anuidade do CREA (botão "Renovar 12m").

## Deploy

```bash
npx supabase login                 # uma vez (abre o navegador)
npx supabase link --project-ref <REF> -p <DB_PASSWORD>
npx supabase db push               # aplica as migrations
npx supabase functions deploy appraise
npx supabase functions deploy generate-report
npx supabase functions deploy report-link
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

> O enriquecimento usa conectores **reais** de dados abertos (relevo/Copernicus, clima/ERA5,
> uso/MapBiomas, solo/EMBRAPA, acesso+hidro/OSM, comparáveis/DERAL-SEAB-PR); IBAMA entra
> quando o geoserver volta. O laudo formal exige ART de profissional habilitado no CREA e é
> gerado em PDF no servidor (`generate-report`).
