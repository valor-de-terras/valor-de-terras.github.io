# Coleta diaria da CAIXA (Frente B) rodada LOCALMENTE (IP residencial).
#
# Por que local: a CAIXA (CDN Azion) bloqueia IPs de datacenter por ASN. Testado 2026-07-03:
# GitHub Actions e Supabase Edge Function recebem HTTP 403; so IP residencial baixa o CSV.
#
# Seguranca: a service_role e lida do keyring do Supabase CLI em tempo de execucao -> nao
# fica armazenada em disco, no git, nem em CI publico. Requer login previo: `supabase login`.
#
# 2026-08-08: trocado `npx supabase` pelo binario fixo em ~\bin\supabase.exe.
# O npx nao achava o pacote em cache, tentava instalar e PARAVA pedindo confirmacao;
# com `2>$null` o prompt sumia e a task ficava travada para sempre (status "Em execucao"),
# o que impedia as execucoes seguintes. 34 dias de snapshot perdidos (05/07 a 08/08).
# Regra: nada no caminho critico pode esperar input. Tudo tem stdin fechado e timeout.
#
# Agendar (uma vez, no seu usuario) - use o CAMINHO ABSOLUTO do script:
# %~dp0 so expande dentro de .bat/.cmd; num console interativo viraria literal.
#   schtasks /Create /TN "ValorDeTerras-ScrapeCaixa" /SC DAILY /ST 08:00 ^
#     /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"E:\UPWORK\01-CONTRACTS\valor-de-terras\scrapers\run_daily.ps1\""
$ErrorActionPreference = "Stop"

$ProjectRef = "ejwzqrrudgweglxkktan"
$env:SUPABASE_URL = "https://$ProjectRef.supabase.co"

$log = Join-Path $PSScriptRoot ("scrape-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
  Write-Host $line
  Add-Content -Path $log -Value $line -Encoding UTF8
}

# --- Localiza o CLI. Binario fixo, nunca npx: npx baixa da rede e pode pedir confirmacao.
$cli = Join-Path $env:USERPROFILE "bin\supabase.exe"
if (-not (Test-Path $cli)) {
  $cmd = Get-Command supabase.exe -ErrorAction SilentlyContinue
  if ($cmd) { $cli = $cmd.Source }
  else {
    Log "ERRO: supabase.exe nao encontrado em ~\bin nem no PATH."
    Log "Instale: https://github.com/supabase/cli/releases (supabase_<ver>_windows_amd64.zip) -> ~\bin\supabase.exe"
    exit 2
  }
}

# --- Busca a service_role com stdin fechado e timeout. Nunca pode bloquear.
$outFile = [System.IO.Path]::GetTempFileName()
$errFile = [System.IO.Path]::GetTempFileName()
try {
  $p = Start-Process -FilePath $cli `
    -ArgumentList @("projects", "api-keys", "--project-ref", $ProjectRef, "-o", "env") `
    -NoNewWindow -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  if (-not $p.WaitForExit(120000)) {
    try { $p.Kill() } catch {}
    Log "ERRO: 'supabase projects api-keys' excedeu 120s e foi encerrado."
    exit 3
  }
  $out = (Get-Content $outFile -Raw -ErrorAction SilentlyContinue) + ""
  $errText = (Get-Content $errFile -Raw -ErrorAction SilentlyContinue) + ""
} finally {
  Remove-Item $outFile, $errFile -Force -ErrorAction SilentlyContinue
}

if ($errText.Trim()) { Log "supabase stderr: $($errText.Trim())" }

if ($out -match '(?im)SERVICE_ROLE[A-Z_]*\s*=\s*"?([A-Za-z0-9._\-]+)') {
  $env:SUPABASE_SERVICE_ROLE_KEY = $Matches[1]
  Log "service_role obtida (projeto $ProjectRef)."
} else {
  # Saida vazia com exit 0 = projeto pausado. O free tier do Supabase pausa apos
  # ~7 dias sem uso, e um scraper parado se torna a causa da propria pausa.
  Log "ERRO: nao obtive a service_role. Saida do CLI veio vazia."
  Log "Causas provaveis, nesta ordem:"
  Log "  1) Projeto PAUSADO (INACTIVE). Verifique: supabase projects list"
  Log "     Retomar em https://supabase.com/dashboard/project/$ProjectRef"
  Log "  2) Login do CLI expirado. Rode: supabase login"
  exit 1
}

# Log diário + propagação do exit code (sem isso a Scheduled Task reporta 0x0
# mesmo com falha e dias perdidos de snapshot passam despercebidos).
# EAP Continue: no PowerShell 5.1 (o do schtasks), stderr do Python dentro de um
# pipeline com EAP Stop vira NativeCommandError TERMINANTE e mata o scraper no meio.
$ErrorActionPreference = "Continue"
Log "iniciando caixa_imoveis.py --uf PR --upsert"
# Nada de Tee-Object aqui: no PS 5.1 ele grava UTF-16 e nao aceita -Encoding, o que
# anexava UTF-16 num arquivo que Log() ja abrira em UTF-8 e deixava o log ilegivel.
# OutputEncoding UTF8 e' o que preserva os acentos (ã, ç, é) vindos do `py -X utf8`.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
py -3 -X utf8 "$PSScriptRoot\caixa_imoveis.py" --uf PR --upsert 2>&1 | ForEach-Object {
  $line = "$_"
  Write-Host $line
  Add-Content -Path $log -Value $line -Encoding UTF8
}
exit $LASTEXITCODE
