# Configura la demo de SalonPro (modo -UrlFija) para que arranque al iniciar sesion.
#
# Usa la clave HKCU\...\Run: no crea .lnk ni .cmd, asi Smart App Control no la
# bloquea. No necesita administrador.
#
#   .\scripts\instalar-demo-inicio.ps1
#   .\scripts\instalar-demo-inicio.ps1 -Quitar
#
# Para probar sin reiniciar sesion, ejecuta el comando que imprime al final.

param(
  [string]$UrlFija = 'https://salonpro-demo.eu1.netbird.services',
  [string]$ClaveAdmin = 'Demo-Admin-4821',
  [switch]$Quitar
)

$ErrorActionPreference = 'Stop'

$raiz = Split-Path -Parent $PSScriptRoot
$scriptDemo = Join-Path $raiz 'scripts\demo-netbird.ps1'
$clave = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$nombre = 'SalonProDemo'

if ($Quitar) {
  $actual = Get-ItemProperty -Path $clave -Name $nombre -ErrorAction SilentlyContinue
  if ($actual) {
    Remove-ItemProperty -Path $clave -Name $nombre
    Write-Host ''
    Write-Host '  Arranque automatico quitado.' -ForegroundColor Green
    Write-Host ''
  } else {
    Write-Host '  No estaba configurado.'
  }
  exit 0
}

if (-not (Test-Path -LiteralPath $scriptDemo)) {
  Write-Host ('  No encuentro ' + $scriptDemo) -ForegroundColor Red
  exit 1
}

$UrlFija = $UrlFija.Trim().TrimEnd('/')
if ($UrlFija -notmatch '^https://[^/\s]+') {
  Write-Host '  UrlFija tiene que ser una URL https.' -ForegroundColor Red
  exit 2
}

$comando = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' +
  $scriptDemo + '" -UrlFija "' + $UrlFija + '" -ClaveAdmin "' + $ClaveAdmin + '" -NoAbrir'

Set-ItemProperty -Path $clave -Name $nombre -Value $comando -Type String

Write-Host ''
Write-Host '  Listo: la demo va a arrancar sola al iniciar sesion.' -ForegroundColor Green
Write-Host ('  URL:         ' + $UrlFija)
Write-Host ('  Clave admin: ' + $ClaveAdmin)
Write-Host ''
Write-Host '  Nota: cada inicio recrea la base de demo (turnos y clientes se resetean).'
Write-Host '  Para quitarlo:  .\scripts\instalar-demo-inicio.ps1 -Quitar'
Write-Host ''
Write-Host '  Para levantarla ahora, sin reiniciar sesion:' -ForegroundColor Yellow
Write-Host ('    ' + $comando)
Write-Host ''
