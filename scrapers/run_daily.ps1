# Coleta diaria da CAIXA (Frente B) rodada LOCALMENTE (IP residencial).
#
# Por que local: a CAIXA (CDN Azion) bloqueia IPs de datacenter por ASN. Testado 2026-07-03:
# GitHub Actions e Supabase Edge Function recebem HTTP 403; so IP residencial baixa o CSV.
#
# Seguranca: a service_role e lida do keyring do Supabase CLI em tempo de execucao -> nao
# fica armazenada em disco, no git, nem em CI publico. Requer login previo: `npx supabase login`.
#
# Agendar (uma vez, no seu usuario):
#   schtasks /Create /TN "ValorDeTerras-ScrapeCaixa" /SC DAILY /ST 08:00 ^
#     /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0run_daily.ps1\""
$ErrorActionPreference = "Stop"
$env:SUPABASE_URL = "https://ejwzqrrudgweglxkktan.supabase.co"
$out = (npx supabase projects api-keys --project-ref ejwzqrrudgweglxkktan -o env 2>$null | Out-String)
if ($out -match '(?im)SERVICE_ROLE[A-Z_]*\s*=\s*"?([A-Za-z0-9._\-]+)') {
  $env:SUPABASE_SERVICE_ROLE_KEY = $Matches[1]
} else {
  Write-Error "Nao obtive a service_role via 'supabase projects api-keys'. Rode: npx supabase login"
  exit 1
}
py -3 -X utf8 "$PSScriptRoot\caixa_imoveis.py" --uf PR --upsert
