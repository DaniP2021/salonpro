# SalonPro - instala el arranque automatico al iniciar sesion en Windows.
#
# Crea un acceso directo en la carpeta de Inicio que levanta el servidor
# minimizado, sin depender de que dejes una ventana abierta.
#
# Uso normal: doble clic en instalar-arranque-automatico.cmd
#
# Uso desde consola (para probar sin tocar el Inicio real):
#   powershell -ExecutionPolicy Bypass -File instalar-arranque-automatico.ps1 -Destino "C:\ruta\prueba" -Silencioso

param(
  [string]$Destino = '',
  [switch]$Silencioso
)

$ErrorActionPreference = 'Stop'

# Carpeta del proyecto: donde esta este script.
$carpeta = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($carpeta)) { $carpeta = (Get-Location).Path }

if ([string]::IsNullOrWhiteSpace($Destino)) {
  $Destino = [Environment]::GetFolderPath('Startup')
}
if ([string]::IsNullOrWhiteSpace($Destino)) {
  Write-Host '  No se pudo encontrar la carpeta de Inicio de Windows.' -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $Destino)) {
  New-Item -ItemType Directory -Force -Path $Destino | Out-Null
}

$lnk = Join-Path $Destino 'SalonPro.lnk'

try {
  $shell = New-Object -ComObject WScript.Shell
  $acceso = $shell.CreateShortcut($lnk)
  $acceso.TargetPath = 'cmd.exe'
  # Escucha en toda la red (Tailscale y WiFi) y deja registro en data\arranque.log
  # Ojo: set "VAR=valor" entrecomillado, si no el espacio antes de && queda
  # dentro del valor y node intenta resolver "0.0.0.0 " (con espacio) y falla.
  $acceso.Arguments = "/c cd /d ""$carpeta"" && set ""SALON_HOST=0.0.0.0"" && node server.js >> data\arranque.log 2>&1"
  $acceso.WorkingDirectory = $carpeta
  $acceso.WindowStyle = 7          # 7 = minimizada: no molesta al iniciar
  $acceso.Description = 'SalonPro - servidor de la app del salon'
  $acceso.IconLocation = 'shell32.dll,13'
  $acceso.Save()
} catch {
  Write-Host ''
  Write-Host "  No se pudo crear el acceso directo: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host ''
  exit 1
}

if (-not (Test-Path $lnk)) {
  Write-Host '  El acceso directo no se creo.' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host '  ============================================'
Write-Host '   Listo.'
Write-Host ''
Write-Host '   SalonPro va a arrancar solo cada vez que'
Write-Host '   inicies sesion en Windows, minimizado.'
Write-Host ''
Write-Host '   Acceso creado en:'
Write-Host "   $lnk"
Write-Host ''
Write-Host '   Para desinstalarlo: borra ese archivo.'
Write-Host '  ============================================'
Write-Host ''

if (-not $Silencioso) {
  Read-Host '  Enter para cerrar' | Out-Null
}
