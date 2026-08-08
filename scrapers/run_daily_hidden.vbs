' Wrapper que roda run_daily.ps1 SEM abrir janela de console.
'
' Por que existe: a Scheduled Task roda na sessao interativa do usuario, entao a
' janela do PowerShell (e a de qualquer processo filho) fica piscando na tela todo
' dia as 08:00. A alternativa seria marcar a task como "run whether user is logged
' on or not", que exige guardar a senha do Windows -- este wrapper evita isso.
'
' O terceiro argumento de .Run e' bWaitOnReturn=True de proposito: sem ele o
' wrapper terminaria na hora e o exit code do scraper se perderia, fazendo a task
' reportar 0x0 mesmo em falha -- exatamente o problema que o run_daily.ps1 se
' preocupa em evitar ao propagar $LASTEXITCODE.
'
' Reapontar a task para ca:
'   schtasks /Change /TN "ValorDeTerras-ScrapeCaixa" ^
'     /TR "wscript.exe \"E:\UPWORK\01-CONTRACTS\valor-de-terras\scrapers\run_daily_hidden.vbs\""

Option Explicit
Dim sh, fso, ps1, rc
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

ps1 = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "run_daily.ps1")

If Not fso.FileExists(ps1) Then
    WScript.Quit 2
End If

rc = sh.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """", 0, True)
WScript.Quit rc
