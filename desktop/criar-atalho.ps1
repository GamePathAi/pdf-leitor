# Cria o atalho "PDF Leitor" na Área de Trabalho e no Menu Iniciar.
# O atalho abre o app publicado numa janela própria (modo app do Chrome ou do Edge).
$ErrorActionPreference = 'Stop'
$url = 'https://gamepathai.github.io/pdf-leitor/'

$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw 'Não encontrei Chrome nem Edge instalados.' }

# Guarda o ícone num lugar fixo, para o atalho não quebrar se a pasta do projeto mudar.
$home_ = Join-Path $env:LOCALAPPDATA 'PDF Leitor'
New-Item -ItemType Directory -Force $home_ | Out-Null
$icon = Join-Path $home_ 'pdf-leitor.ico'
Copy-Item (Join-Path $PSScriptRoot 'pdf-leitor.ico') $icon -Force

$shell = New-Object -ComObject WScript.Shell
$places = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) '')
)
foreach ($dir in $places) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'PDF Leitor.lnk'))
  $lnk.TargetPath = $browser
  $lnk.Arguments = "--app=$url"
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = 'PDF Leitor - leitor e editor de PDF sem propaganda'
  $lnk.WorkingDirectory = Split-Path $browser
  $lnk.Save()
  Write-Output "Atalho criado: $(Join-Path $dir 'PDF Leitor.lnk')"
}
