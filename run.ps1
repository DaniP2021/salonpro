# SalonPro · arranque rápido en Windows
#   .\run.ps1              -> arranca en http://127.0.0.1:8000
#   .\run.ps1 -Puerto 8111 -> otro puerto
#   .\run.ps1 -Demo        -> carga (o recarga) los datos de demostración y arranca

param(
  [int]$Puerto = 8000,
  [switch]$Demo
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $raiz

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ''
  Write-Host '  No se encontró Node.js.' -ForegroundColor Red
  Write-Host '  Instalá Node 22.5 o superior desde https://nodejs.org (versión LTS) y volvé a intentar.'
  Write-Host ''
  exit 1
}

$version = [int]((node -v).TrimStart('v').Split('.')[0])
if ($version -lt 22) {
  Write-Host ''
  Write-Host "  Node $(node -v) es demasiado viejo: esta app necesita Node 22.5 o superior." -ForegroundColor Red
  Write-Host '  Actualizá desde https://nodejs.org'
  Write-Host ''
  exit 1
}

if ($Demo) {
  Write-Host ''
  Write-Host '  Cargando datos de demostración…' -ForegroundColor Yellow
  $env:SALON_DESPACHO = '0'
  node scripts/seed.js --si
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  Falló la carga de datos de demostración.' -ForegroundColor Red
    exit 1
  }
}

$env:SALON_PORT = "$Puerto"
Write-Host ''
Write-Host '  ────────────────────────────────────────────' -ForegroundColor DarkGray
Write-Host "   SalonPro corriendo en:" -ForegroundColor Green
Write-Host "   http://127.0.0.1:$Puerto" -ForegroundColor Cyan
Write-Host ''
Write-Host '   Para entrar:  admin@salon.local / salon2026'
Write-Host '   Para detener: Ctrl + C'
Write-Host '  ────────────────────────────────────────────' -ForegroundColor DarkGray
Write-Host ''

node server.js
