# Scrapers — base de comparáveis (Frente B)

Motor de coleta de anúncios de imóveis para a base própria de comparáveis do Valor de
Terras (preço, área, município, tipo, modalidade e **tempo de anúncio** = iliquidez).

Só stdlib (sem `pip install`). Preserva acentos pt-BR. Guarda apenas dados **factuais**.

## Tabelas (ver `supabase/migrations/20260703120000_market_listings.sql`)

- `market_listings` — estado atual de cada anúncio (chave natural `source` + `source_id`).
- `listing_snapshots` — 1 linha por anúncio por dia (curva de sobrevivência / iliquidez).
- `scrape_runs` — proveniência de cada coleta (reprodutibilidade).
- `liquidity_stats` — agregado por município + faixa de área (recalculado em lote).

Acesso **restrito** (RLS sem policies): sem leitura anônima. Escrita via **service role**;
a estimativa lê via função `SECURITY DEFINER`. Consistente com o gating da Frente A
(o valor não vaza pro cliente).

## Fonte-piloto: CAIXA (listas CSV públicas por UF)

`scrapers/caixa_imoveis.py` — a CAIXA publica, por estado, uma lista CSV pública de
imóveis à venda (venda direta, leilão SFI, licitação). Fonte de **baixo risco legal**
(dado público de banco público federal, sem robots.txt, download oficial direto).

Detalhes de parsing (validados): arquivo `latin-1`, delimitador `;`, cabeçalho real na 3ª
linha (12 colunas); **dois formatos numéricos no mesmo arquivo** (Preço/Avaliação em BR
`1.331.000,00`; Área/Desconto em US `197270.00`); área vem embutida na coluna Descrição
(regex → m² → /10000 = ha); tipo Terreno/Gleba → `rural`.

```bash
# valida o parse SEM tocar o banco (imprime amostra + estatísticas)
py -3 scrapers/caixa_imoveis.py --uf PR --dry-run --limit 5

# carrega no Supabase (precisa das env vars; service role NUNCA vai pro git)
set SUPABASE_URL=https://ejwzqrrudgweglxkktan.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=****   # npx supabase projects api-keys ... -o env
py -3 scrapers/caixa_imoveis.py --uf PR --upsert

# nacional: iterar as 27 UFs (não há arquivo BR agregado)
py -3 scrapers/caixa_imoveis.py --uf all --upsert
```

## Iliquidez (tempo de anúncio) — mecanismo

A CAIXA **não** traz data por anúncio; o arquivo é regenerado todo dia (HTTP
`Last-Modified` ~01:00 GMT) e cada imóvel tem chave estável (`Nº do imóvel`). Logo:
rodar **snapshot diário**, gravar em `listing_snapshots`, e derivar
`first_seen`/`last_seen`/`dias_ativo`; quando o id some, `status='inativo'` + `removed_at`
(proxy de venda). O trigger `market_listings_touch` já preserva `first_seen` e recalcula
`dias_ativo` a cada upsert.

## Automação — precisa de IP residencial (NÃO datacenter)

Descoberta (2026-07-03): o CDN da CAIXA (Azion) **bloqueia IPs de datacenter por ASN**.
Testado: **GitHub Actions e Supabase Edge Function recebem HTTP 403** (mesmo servido de
São Paulo). Só um **IP residencial** baixa o CSV. Portanto a coleta roda **localmente**.

`scrapers/run_daily.ps1` faz a coleta lendo a `service_role` do **keyring do Supabase CLI
em tempo de execução** (nada armazenado em disco, git ou CI público; requer
`npx supabase login`). Agendado no Windows (Agendador de Tarefas):

```powershell
schtasks /Create /TN "ValorDeTerras-ScrapeCaixa" /SC DAILY /ST 08:00 /F `
  /TR '"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "E:\UPWORK\01-CONTRACTS\valor-de-terras\scrapers\run_daily.ps1"'
# remover:  schtasks /Delete /TN "ValorDeTerras-ScrapeCaixa" /F
```

Alternativas para tirar da máquina local no futuro: um VPS/proxy com IP residencial BR, ou
uma fonte que não bloqueie datacenter (ex.: Mega Leilões) via Edge Function + pg_cron.

## Guardrails legais (obrigatórios ao escalar)

- Respeitar `robots.txt` por host. NÃO raspar hosts com anti-bot/403 ou ToS anti-scraping
  (ZAP, VivaReal, OLX, Imovelweb, Wimoveis, Sodré, Zukerman).
- Preferir fonte oficial/primária a agregador que revende dado de terceiros.
- Guardar só dados factuais (preço, área, município, modalidade, matrícula, datas). NÃO
  redistribuir descrição autoral nem fotos (`payload_raw` é só auditoria interna).
- **LGPD:** nunca persistir PII do anunciante (nome/telefone). Strip na ingestão.
- Rate limit + backoff + User-Agent identificável. Coleta em massa via CSV/bulk; ficha de
  detalhe só por amostra/sob demanda.
- Rotular `price_basis`: anúncio/lance = **oferta** (≠ transação, distinção NBR 14.653).

## Roadmap (próximas fontes, por prioridade)

1. CAIXA PR (piloto) → nacional (27 UFs). **[feito: schema + coletor validados]**
2. Job de snapshot diário + engine de diff (entrega o sinal de iliquidez).
3. Geocodificação (município+endereço+CEP → lat/long) + código IBGE.
4. Mega Leilões (rural PR, risco médio; robots só bloqueia /login): 1ª/2ª praça, proxy de iliquidez.
5. DERAL/SEAB-PR (SIPT) e INCRA/SIGEF/SICAR/IBGE para validação NBR e bounds de sanidade.
6. Oferta rural (MF Rural / Chaves na Mão) reusando a engine de snapshot.
