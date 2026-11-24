# SalonPro - demo publica temporal con NetBird (camino B1: "netbird expose").
#
# Levanta una instancia de PRUEBA en el puerto 8100 con su propia base
# (data/demo-netbird.db), la expone por HTTPS con netbird expose y reinicia la
# app para que los links de WhatsApp usen esa URL.
#
# Uso normal (doble clic):  demo-netbird.cmd
# Uso desde consola:        .\demo-netbird.cmd -ClaveProxy "clave larga" -NoAbrir
# Solo mostrar el plan:     .\demo-netbird.cmd -DryRun
#
# Requisitos: Node >= 22.5, NetBird instalado y conectado, Peer Expose activo
# en el panel y "Block Inbound Connections" desactivado en el peer.
#
# Notas de implementacion:
#  - La clave del proxy NUNCA se escribe en logs ni en el banner.
#  - Solo se matan los procesos que arranco este script.
#  - La base real (data/salon.db) no se toca nunca.

[CmdletBinding()]
param(
  [int]$Puerto = 8100,
  [string]$Nombre = 'salonpro',
  [string]$ClaveProxy = '',
  [string]$ClaveAdmin = '',
  [string]$UrlFija = '',
  [switch]$DryRun,
  [switch]$NoAbrir,
  [switch]$Conservar,
  [switch]$YaIntenteElevar
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

$Raiz        = Split-Path -Parent $PSScriptRoot
$DirDatos    = Join-Path $Raiz 'data'
$RutaDb      = Join-Path $DirDatos 'demo-netbird.db'
$LogExpose   = Join-Path $DirDatos 'demo-netbird.log'
$LogExposeErr = Join-Path $DirDatos 'demo-netbird.err.log'
$LogApp1     = Join-Path $DirDatos 'demo-netbird-app-1.log'
$LogApp1Err  = Join-Path $DirDatos 'demo-netbird-app-1.err.log'
$LogApp2     = Join-Path $DirDatos 'demo-netbird-app-2.log'
$LogApp2Err  = Join-Path $DirDatos 'demo-netbird-app-2.err.log'
$RutaCred    = Join-Path $DirDatos 'demo-credenciales.txt'
$UrlLocal    = "http://127.0.0.1:$Puerto"

$script:ProcesoApp    = $null
$script:ProcesoExpose = $null
$script:UrlPublica    = $null
$script:BaseUrlFase1  = $UrlLocal
$script:Arranco       = $false

# ---------------------------------------------------------------- utilidades

function Escribir([string]$texto, [string]$color = 'Gray') {
  Write-Host $texto -ForegroundColor $color
}

function Falla([int]$codigo, [string]$mensaje) {
  Write-Host ''
  Write-Host ('  ERROR: ' + $mensaje) -ForegroundColor Red
  Write-Host ''
  exit $codigo
}

function Citar-Argumento([string]$valor) {
  if ($valor -match '[\s"]') {
    return '"' + ($valor -replace '"', '\"') + '"'
  }
  return $valor
}

function Leer-ClaveSegura([string]$mensaje) {
  $segura = Read-Host -Prompt $mensaje -AsSecureString
  $puntero = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringAuto($puntero)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($puntero)
  }
}

function Generar-Clave([int]$largo = 20) {
  $alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $salida = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt $largo; $i++) {
    [void]$salida.Append($alfabeto[(Get-Random -Maximum $alfabeto.Length)])
  }
  return $salida.ToString()
}

function Pid-PuertoOcupado {
  try {
    $linea = netstat -ano 2>$null | Where-Object { $_ -match ":$Puerto\s" -and $_ -match 'LISTENING' } | Select-Object -First 1
    if ($linea -and $linea -match '\s(\d+)\s*$') { return [int]$Matches[1] }
  } catch { }
  return $null
}

function Puerto-Ocupado {
  # 1) Si algo escucha, la conexion entra. Detecta 127.0.0.1 y 0.0.0.0.
  $cliente = $null
  try {
    $cliente = New-Object System.Net.Sockets.TcpClient
    $tarea = $cliente.ConnectAsync('127.0.0.1', $Puerto)
    if ($tarea.Wait(400) -and $cliente.Connected) { return $true }
  } catch {
    # conexion rechazada: nadie escucha
  } finally {
    if ($cliente) { try { $cliente.Close() } catch { } }
  }

  # 2) Bind en 0.0.0.0, igual que la app. Detecta sockets que no aceptan
  # conexiones en Loopback (el caso que dejaba pasar la demo anterior).
  $escucha = $null
  try {
    $escucha = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Puerto)
    $escucha.Start()
    return $false
  } catch {
    return $true
  } finally {
    if ($escucha) {
      try { $escucha.Stop() } catch { }
    }
  }
}

function Esperar-PuertoLibre([int]$segundos = 10) {
  $limite = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $limite) {
    if (-not (Puerto-Ocupado)) { return $true }
    Start-Sleep -Milliseconds 300
  }
  return (-not (Puerto-Ocupado))
}

function Comprobar-Node {
  $version = (& node --version 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $version) {
    Falla 3 'No se encontro Node.js. Instalalo desde https://nodejs.org (22.5 o superior).'
  }
  $partes = $version.TrimStart('v').Split('.')
  $mayor = 0
  $menor = 0
  [void][int]::TryParse($partes[0], [ref]$mayor)
  if ($partes.Length -gt 1) { [void][int]::TryParse($partes[1], [ref]$menor) }
  if ($mayor -lt 22 -or ($mayor -eq 22 -and $menor -lt 5)) {
    Falla 3 ("Node $version es demasiado viejo: la app necesita 22.5 o superior.")
  }
  return $version
}

function Es-Administrador {
  try {
    $identidad = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identidad)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch {
    return $false
  }
}

function Buscar-NetBird {
  if ($env:NETBIRD_EXE -and (Test-Path -LiteralPath $env:NETBIRD_EXE)) {
    return (Resolve-Path -LiteralPath $env:NETBIRD_EXE).Path
  }
  $comando = Get-Command netbird -ErrorAction SilentlyContinue
  if ($comando) { return $comando.Source }

  # El PATH de una consola abierta antes de instalar NetBird queda viejo.
  $candidatos = @(
    (Join-Path $env:ProgramFiles 'Netbird\netbird.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Netbird\netbird.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\netbird\netbird.exe'),
    'C:\Program Files\NetBird\netbird.exe'
  )
  foreach ($ruta in $candidatos) {
    if ($ruta -and (Test-Path -LiteralPath $ruta)) { return (Resolve-Path -LiteralPath $ruta).Path }
  }
  return $null
}

function Ejecutar-Nativo([string]$exe, [string[]]$argumentos) {
  # Con ErrorActionPreference=Stop, un comando nativo que escribe en stderr
  # corta el script. Se captura la salida y el codigo sin que eso pase.
  $anterior = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $texto = (& $exe @argumentos 2>&1 | Out-String)
    $codigo = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $anterior
  }
  return @{ codigo = $codigo; texto = $texto }
}

function Comprobar-NetBird([string]$exe) {
  $resultado = Ejecutar-Nativo $exe @('status', '--ipv4')
  $salida = $resultado.texto
  if ($resultado.codigo -ne 0) {
    if ($salida -match 'not allowed to use the NetBird daemon|Acceso denegado') {
      if (Es-Administrador) {
        Falla 3 ('El daemon de NetBird rechaza incluso a esta sesion de administrador. ' +
          'Revisa el servicio Netbird (services.msc) o reinstalalo. Detalle: ' + $salida.Trim())
      }
      Falla 3 ('NetBird esta instalado, pero su daemon solo acepta administradores. ' +
        'Cerra esta ventana y abri demo-netbird.cmd con clic derecho -> "Ejecutar como administrador". ' +
        'Alternativa permanente (una vez, como admin): netbird service install --allow-group "Usuarios".')
    }
    Falla 3 ('NetBird no esta conectado. Abri la app de NetBird, elegi Connect y volve a probar. Detalle: ' + $salida.Trim())
  }
  $ip = ''
  foreach ($linea in ($salida -split "`r?`n")) {
    if ($linea.Trim() -match '^\d{1,3}(\.\d{1,3}){3}$') { $ip = $linea.Trim(); break }
  }
  if (-not $ip) {
    Falla 3 'NetBird no devolvio una IP (100.x). Revisa que el peer este conectado a la red.'
  }
  return $ip
}

function Citar-Parametro([string]$valor) {
  if ($valor -match '\s') { return '"' + $valor + '"' }
  return $valor
}

function Relanzar-Elevado {
  $linea = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
  $linea += ' -Puerto ' + $Puerto
  $linea += ' -Nombre ' + (Citar-Parametro $Nombre)
  if ($ClaveProxy) { $linea += ' -ClaveProxy ' + (Citar-Parametro $ClaveProxy) }
  if ($ClaveAdmin) { $linea += ' -ClaveAdmin ' + (Citar-Parametro $ClaveAdmin) }
  if ($NoAbrir) { $linea += ' -NoAbrir' }
  if ($Conservar) { $linea += ' -Conservar' }
  $linea += ' -YaIntenteElevar'

  # Marca para que el hijo sepa que ya se intento elevar y no entre en bucle
  # si Windows no le dio privilegios.
  $env:SALON_DEMO_ELEVADO = '1'

  try {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $linea
  } catch {
    Falla 3 ('No se pudo pedir elevacion (' + $_.Exception.Message + '). ' +
      'Abri PowerShell como administrador y volve a correr el script.')
  }

  Escribir ''
  Escribir '  Se abrio una ventana elevada con la demo.' 'Green'
  Escribir '  Segui el aviso en esa ventana (ahi van a aparecer la URL y la clave).'
  exit 0
}

function Comprobar-Expose([string]$exe) {
  $resultado = Ejecutar-Nativo $exe @('expose', '--help')
  $ayuda = $resultado.texto
  if ($ayuda -and ($ayuda -notmatch 'with-password')) {
    Falla 3 ('La version de NetBird instalada no parece soportar "expose --with-password". Actualizala y volve a probar.')
  }
}

# ------------------------------------------------------------------- app

function Iniciar-App([string]$baseUrl, [string]$log, [string]$logErr) {
  $env:SALON_HOST = '0.0.0.0'
  $env:SALON_PORT = "$Puerto"
  $env:SALON_DB = $RutaDb
  $env:SALON_DESPACHO = '0'
  $env:SALON_BASE_URL = $baseUrl
  # Con esta variable, la app actualiza el archivo cuando se cambia la clave.
  $env:SALON_DEMO_CRED_FILE = $RutaCred
  # Verificacion del webhook de WhatsApp (la muestra el panel de la app).
  $env:SALON_WA_VERIFY_TOKEN = $TokenWa
  $proceso = Start-Process -FilePath 'node' -ArgumentList 'server.js' `
    -WorkingDirectory $Raiz -RedirectStandardOutput $log -RedirectStandardError $logErr `
    -WindowStyle Hidden -PassThru
  return $proceso
}

function Escribir-Credenciales([string]$url, [string]$proxy, [string]$usuario, [string]$clave) {
  $lineas = @(
    '# SalonPro - credenciales de la demo publica',
    '# Archivo local: no compartir ni versionar mientras la demo este abierta.',
    '# La clave se actualiza sola cuando se cambia desde la app.',
    ('URL=' + $url),
    ('PROXY=' + $proxy),
    ('USUARIO=' + $usuario),
    ('CLAVE=' + $clave),
    ('ACTUALIZADO=' + (Get-Date -Format 'yyyy-MM-dd HH:mm')),
    ''
  )
  # UTF-8 sin BOM: conserva acentos y el lector de la app lo interpreta igual.
  $codificacion = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($RutaCred, [string[]]$lineas, $codificacion)
}

function Esperar-Health([int]$segundos = 30, $proceso = $null) {
  $limite = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $limite) {
    # Si el proceso que arrancamos murio (por ejemplo, EADDRINUSE), no sirve
    # que otro servidor viejo responda 200 en el mismo puerto.
    if ($proceso -and $proceso.HasExited) { return $false }
    if ($proceso) {
      $dueno = Pid-PuertoOcupado
      if ($dueno -and $dueno -ne $proceso.Id) { return $false }
    }
    try {
      $respuesta = Invoke-WebRequest -Uri "$UrlLocal/" -UseBasicParsing -TimeoutSec 3
      if ($respuesta.StatusCode -eq 200) { return $true }
    } catch {
      # todavia no responde
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Obtener-Hijos([int]$padre) {
  $salida = @()
  try {
    $hijos = Get-CimInstance Win32_Process -Filter "ParentProcessId=$padre" -ErrorAction SilentlyContinue
    foreach ($hijo in $hijos) {
      $salida += [int]$hijo.ProcessId
      $salida += Obtener-Hijos ([int]$hijo.ProcessId)
    }
  } catch {
    # sin permisos para ver el arbol: se sigue con el proceso padre
  }
  return $salida
}

function Detener-Proceso($proceso) {
  if ($null -eq $proceso) { return }
  $identificador = $proceso.Id

  # Se anota el arbol antes de matar: si taskkill no esta permitido en el
  # equipo, igual se cierran los hijos a mano.
  $arbol = @()
  try { $arbol = Obtener-Hijos $identificador } catch { }

  try {
    if (-not $proceso.HasExited) {
      & taskkill /PID $identificador /T /F 2>&1 | Out-Null
    }
  } catch {
    # sigue el plan B
  }

  if (-not $proceso.HasExited) {
    foreach ($hijo in $arbol) {
      Stop-Process -Id $hijo -Force -ErrorAction SilentlyContinue
    }
    Stop-Process -Id $identificador -Force -ErrorAction SilentlyContinue
  }

  try { [void]$proceso.WaitForExit(5000) } catch { }
}

# --------------------------------------------------------------- admin

function Cambiar-ClaveAdmin([string]$nueva) {
  $sesion = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Invoke-RestMethod -Uri "$UrlLocal/api/auth/login" -Method Post -ContentType 'application/json' `
    -Body (@{ email = 'admin@salon.local'; clave = 'salon2026' } | ConvertTo-Json) -WebSession $sesion | Out-Null
  Invoke-RestMethod -Uri "$UrlLocal/api/auth/clave" -Method Post -ContentType 'application/json' `
    -Body (@{ actual = 'salon2026'; nueva = $nueva } | ConvertTo-Json) -WebSession $sesion | Out-Null

  $prueba = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Invoke-RestMethod -Uri "$UrlLocal/api/auth/login" -Method Post -ContentType 'application/json' `
    -Body (@{ email = 'admin@salon.local'; clave = $nueva } | ConvertTo-Json) -WebSession $prueba | Out-Null
}

# ------------------------------------------------------------- expose

function Iniciar-Expose([string]$exe, [string]$clave) {
  $argumentos = 'expose ' + $Puerto + ' --with-password ' + (Citar-Argumento $clave) + `
    ' --with-name-prefix ' + (Citar-Argumento $Nombre)

  # Un shim .cmd/.bat (por ejemplo un NetBird envuelto) no se puede iniciar
  # directo con redireccion: se lanza a traves de cmd.exe.
  if ($exe -match '\.(cmd|bat)$') {
    return Start-Process -FilePath $env:ComSpec -ArgumentList ('/c "' + $exe + '" ' + $argumentos) `
      -RedirectStandardOutput $LogExpose -RedirectStandardError $LogExposeErr `
      -WindowStyle Hidden -PassThru
  }

  return Start-Process -FilePath $exe -ArgumentList $argumentos `
    -RedirectStandardOutput $LogExpose -RedirectStandardError $LogExposeErr `
    -WindowStyle Hidden -PassThru
}

function Esperar-Url([int]$segundos = 60) {
  $limite = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $limite) {
    foreach ($archivo in @($LogExpose, $LogExposeErr)) {
      if (Test-Path -LiteralPath $archivo) {
        $texto = Get-Content -LiteralPath $archivo -Raw -ErrorAction SilentlyContinue
        if ($texto) {
          $coincidencia = [regex]::Match($texto, 'https://[^\s"''<>]+')
          if ($coincidencia.Success) {
            return $coincidencia.Value.TrimEnd('.', ',', ')')
          }
        }
      }
    }
    if ($script:ProcesoExpose -and $script:ProcesoExpose.HasExited) { break }
    Start-Sleep -Milliseconds 500
  }
  return $null
}

# ------------------------------------------------------------- banner

function Mostrar-Banner {
  param([string]$url, [string]$admin, [string]$claveAdmin)

  Escribir ''
  Escribir '  ============================================================' 'DarkYellow'
  Escribir '   SalonPro - DEMO PUBLICA TEMPORAL' 'Yellow'
  Escribir '  ============================================================' 'DarkYellow'
  Escribir ''
  Escribir ('   URL:        ' + $url) 'White'
  Escribir ('   Usuario:    ' + $admin)
  Escribir ('   Clave:      ' + $claveAdmin + '   (se muestra solo esta vez)') 'White'
  if ($UrlFija) {
    Escribir '   Proxy:      la configurada en el panel de NetBird'
  } else {
    Escribir '   Proxy:      clave definida (no se muestra)'
  }
  Escribir ('   Webhook WA: token ' + $TokenWa + ' (verificacion de Meta)')
  Escribir '   WhatsApp:   modo enlace (cada mensaje trae un link wa.me)'
  Escribir ''
  Escribir '   Es una instancia de PRUEBA con datos de demo.' 'DarkYellow'
  if ($UrlFija) {
    Escribir '   La URL es fija (B2): mientras la app este corriendo, el link' 'DarkYellow'
    Escribir '   responde en cualquier PC o celular.' 'DarkYellow'
  } else {
    Escribir '   La URL es publica en internet y efimera: vive mientras' 'DarkYellow'
    Escribir '   esta ventana quede abierta.' 'DarkYellow'
  }
  Escribir ''
  Escribir '   Para cortar todo: Ctrl + C' 'Yellow'
  Escribir '  ============================================================' 'DarkYellow'
  Escribir ''
}

# ---------------------------------------------------------------- programa

$versionNode = Comprobar-Node

if ($Puerto -lt 1024 -or $Puerto -gt 65535) {
  Falla 2 'El puerto debe estar entre 1024 y 65535.'
}
if ($Puerto -eq 8000) {
  Falla 2 'No uses el puerto 8000 para la demo: es el de la app real. Eleji otro (8100 por defecto).'
}
if ($Nombre -notmatch '^[a-z0-9][a-z0-9-]{0,30}$') {
  Falla 2 'El nombre debe tener solo minusculas, numeros y guiones (ej.: salonpro).'
}

# URL fija (camino B2): si se pasa, no se usa netbird expose.
if (-not [string]::IsNullOrWhiteSpace($UrlFija)) {
  $UrlFija = $UrlFija.Trim().TrimEnd('/')
  if ($UrlFija -notmatch '^https://[^/\s]+') {
    Falla 2 'UrlFija debe ser una URL https, ej.: https://salonpro-demo.eu1.netbird.services'
  }
}

$rutaReal = [System.IO.Path]::GetFullPath((Join-Path $DirDatos 'salon.db'))
$rutaDemo = [System.IO.Path]::GetFullPath($RutaDb)
if ($rutaReal -eq $rutaDemo) {
  Falla 2 'La base de la demo no puede ser data/salon.db (la base real).'
}

if (-not $UrlFija) {
  if ([string]::IsNullOrWhiteSpace($ClaveProxy)) {
    if ($DryRun) {
      $ClaveProxy = '<definir-con-ClaveProxy>'
    } else {
      $ClaveProxy = Leer-ClaveSegura 'Clave para el proxy (minimo 16 caracteres, no se muestra)'
    }
  }
  if ($ClaveProxy.Length -lt 16) {
    Falla 2 'La clave del proxy debe tener al menos 16 caracteres.'
  }
  if ($ClaveProxy -match '"' -or $ClaveProxy -match "`r" -or $ClaveProxy -match "`n") {
    Falla 2 'La clave del proxy no puede tener comillas ni saltos de linea.'
  }
} else {
  # Con B2 la clave se configura en el panel de NetBird, no aca.
  $ClaveProxy = '(definida en el panel de NetBird)'
}

if ([string]::IsNullOrWhiteSpace($ClaveAdmin)) {
  $ClaveAdmin = Generar-Clave 20
}
if ($ClaveAdmin.Length -lt 8) {
  Falla 2 'La clave de administracion debe tener al menos 8 caracteres.'
}

# Token de verificacion del webhook de WhatsApp (para cuando se conecte Meta).
$TokenWa = $env:SALON_WA_VERIFY_TOKEN
if ([string]::IsNullOrWhiteSpace($TokenWa)) {
  $TokenWa = Generar-Clave 24
}

$netbird = Buscar-NetBird

if ($DryRun) {
  Escribir ''
  Escribir '  MODO DRYRUN: no se toca NetBird ni se arranca nada.' 'Yellow'
  Escribir ''
  Escribir ('  Node:        ' + $versionNode)
  Escribir ('  NetBird:     ' + $(if ($UrlFija) { 'no se usa (URL fija B2)' } elseif ($netbird) { $netbird } else { 'NO ENCONTRADO (la corrida real lo exige)' }))
  if ($UrlFija) { Escribir ('  URL fija:    ' + $UrlFija) }
  Escribir ('  Base:        ' + $RutaDb)
  Escribir ('  Credenciales: ' + $RutaCred)
  Escribir ('  Webhook WA:  token ' + $TokenWa)
  Escribir '  WhatsApp:    modo enlace (SALON_WA_MODO=enlace al sembrar)'
  Escribir ('  Puerto:      ' + $Puerto)
  Escribir ''
  Escribir '  Comandos que ejecutaria:'
  Escribir ''
  Escribir ('    node scripts\seed.js --si    (SALON_DB=' + $RutaDb + ', SALON_DESPACHO=0)')
  Escribir ('    $env:SALON_HOST=0.0.0.0; $env:SALON_PORT=' + $Puerto + '; $env:SALON_DB=' + $RutaDb)
  Escribir ('    $env:SALON_DESPACHO=0; $env:SALON_BASE_URL=' + $(if ($UrlFija) { $UrlFija } else { $UrlLocal }))
  Escribir '    node server.js'
  if (-not $UrlFija) {
    Escribir ('    netbird expose ' + $Puerto + ' --with-password "<definida>" --with-name-prefix ' + $Nombre)
    Escribir ('    (repetir node server.js con SALON_BASE_URL=<URL HTTPS>)')
  }
  Escribir ('    (copiar la URL al portapapeles y abrir el navegador' + $(if ($NoAbrir) { '; -NoAbrir activo' } else { '' }) + ')')
  Escribir ''
  exit 0
}

if (-not $UrlFija) {
  if (-not $netbird) {
    Falla 3 ('No se encontro "netbird" en el PATH. Instalalo desde https://pkgs.netbird.io/windows/x64 ' +
      'y abri una terminal nueva. Ver docs/DEMO-NETBIRD.md.')
  }

  # En Windows el daemon suele aceptar solo administradores. Se comprueba antes
  # de pedir la clave del proxy para no hacer escribir dos veces.
  if (-not (Es-Administrador)) {
    $prueba = Ejecutar-Nativo $netbird @('status', '--ipv4')
    if ($prueba.codigo -ne 0 -and $prueba.texto -match 'not allowed to use the NetBird daemon|Acceso denegado') {
      if ($YaIntenteElevar -or $env:SALON_DEMO_ELEVADO -eq '1') {
        Falla 3 ('No se pudo obtener la elevacion automaticamente. ' +
          'Abri PowerShell con clic derecho -> "Ejecutar como administrador" y volve a correr el comando.')
      }
      Escribir ''
      Escribir '  NetBird necesita permisos de administrador: pidiendo elevacion a Windows...' 'Yellow'
      Relanzar-Elevado
    }
  }
}

if (Puerto-Ocupado) {
  $dueno = Pid-PuertoOcupado
  $detalle = ''
  if ($dueno) { $detalle = ' Lo usa el PID ' + $dueno + '.' }
  Falla 4 ("El puerto $Puerto ya esta en uso.$detalle Cerra ese proceso y volve a probar " +
    '(no se mata nada ajeno). Si es una demo anterior colgada, en una consola de administrador: ' +
    'Stop-Process -Id ' + $dueno + ' -Force')
}

if ($UrlFija) {
  $ipNetbird = 'URL fija (B2)'
} else {
  $ipNetbird = Comprobar-NetBird $netbird
  Comprobar-Expose $netbird
}

if (-not (Test-Path -LiteralPath $DirDatos)) {
  New-Item -ItemType Directory -Force -Path $DirDatos | Out-Null
}

$codigoSalida = 0

try {
  Escribir ''
  Escribir '  SalonPro demo NetBird' 'Yellow'
  Escribir ('  NetBird conectado. IP: ' + $ipNetbird)
  Escribir ('  Base de prueba: ' + $RutaDb)

  # 1) Base nueva (salvo -Conservar)
  if (-not $Conservar) {
    foreach ($archivo in @($RutaDb, "$RutaDb-wal", "$RutaDb-shm", "$RutaDb-journal")) {
      if (Test-Path -LiteralPath $archivo) { Remove-Item -LiteralPath $archivo -Force -ErrorAction SilentlyContinue }
    }
  }

  Escribir '  Cargando datos de demostracion...'
  $env:SALON_DB = $RutaDb
  $env:SALON_DESPACHO = '0'
  # WhatsApp en modo enlace: cada mensaje genera un wa.me para enviar a mano.
  $env:SALON_WA_MODO = 'enlace'
  $salidaSeed = (& node (Join-Path $Raiz 'scripts\seed.js') --si 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    Escribir $salidaSeed
    Falla 5 'No se pudo sembrar la base de demo (ver el error de arriba).'
  }

  # 2) App (con la URL fija de B2 o con la temporal antes de exponer)
  $baseInicial = if ($UrlFija) { $UrlFija } else { $UrlLocal }
  $script:ProcesoApp = Iniciar-App $baseInicial $LogApp1 $LogApp1Err
  $script:Arranco = $true
  if (-not (Esperar-Health 30 $script:ProcesoApp)) {
    Write-Host '  ----- log de la app -----' -ForegroundColor DarkYellow
    foreach ($archivo in @($LogApp1, $LogApp1Err)) {
      if (Test-Path -LiteralPath $archivo) { Get-Content -LiteralPath $archivo -Tail 10 }
    }
    Falla 5 ('La app no arranco en ' + $baseInicial + '. Revisa ' + $LogApp1)
  }

  # 3) Clave de administracion nueva
  Escribir '  Cambiando la clave de administracion de la demo...'
  try {
    Cambiar-ClaveAdmin $ClaveAdmin
  } catch {
    Falla 8 ('No se pudo cambiar la clave de admin: ' + $_.Exception.Message)
  }
  Escribir-Credenciales $baseInicial $ClaveProxy 'admin@salon.local' $ClaveAdmin
  Escribir ('  Credenciales en: ' + $RutaCred)

  if ($UrlFija) {
    # Camino B2: el dominio ya existe en el panel de NetBird.
    $script:UrlPublica = $UrlFija
    Escribir ('  URL fija (B2): ' + $UrlFija)
    Escribir-Credenciales $script:UrlPublica $ClaveProxy 'admin@salon.local' $ClaveAdmin
  } else {
  # 4) Exponer por HTTPS
  Escribir ('  Exponiendo el puerto ' + $Puerto + ' con netbird expose...')
  $script:ProcesoExpose = Iniciar-Expose $netbird $ClaveProxy

  $script:UrlPublica = Esperar-Url 60
  if (-not $script:UrlPublica) {
    Escribir ''
    Escribir '  No aparecio una URL HTTPS en el log de netbird expose.' 'Red'

    $detalleLog = ''
    if (Test-Path -LiteralPath $LogExpose) {
      $detalleLog += (Get-Content -LiteralPath $LogExpose -Raw -ErrorAction SilentlyContinue)
      Escribir '  ----- log de netbird expose -----' 'DarkYellow'
      Get-Content -LiteralPath $LogExpose -Tail 15 | ForEach-Object { Escribir ('   ' + $_) }
    }
    if (Test-Path -LiteralPath $LogExposeErr) {
      $detalleLog += (Get-Content -LiteralPath $LogExposeErr -Raw -ErrorAction SilentlyContinue)
      Get-Content -LiteralPath $LogExposeErr -Tail 15 | ForEach-Object { Escribir ('   ' + $_) }
    }
    Escribir '  ----- fin del log -----' 'DarkYellow'
    Escribir ''

    if ($detalleLog -match 'peer expose is not enabled') {
      Escribir '  La cuenta de NetBird no tiene Peer Expose habilitado.' 'Yellow'
      Escribir '  No es un problema de esta PC ni del script. Pasos:' 'Yellow'
      Escribir '   1. Entra a https://app.netbird.io/settings con rol Owner o Admin.' 'Yellow'
      Escribir '   2. Settings -> Clients -> "Expose Services from CLI".' 'Yellow'
      Escribir '   3. Activa "Enable Peer Expose".' 'Yellow'
      Escribir '   4. En "Allowed peer groups" elegi el grupo de esta PC y guarda.' 'Yellow'
      Escribir '   5. Revisa que el peer no tenga "Block Inbound Connections".' 'Yellow'
      Escribir '   6. Volve a correr este comando.' 'Yellow'
      Falla 6 'Peer Expose no esta habilitado en la cuenta de NetBird.'
    }

    Escribir '  Revisa que en el panel de NetBird esten: Peer Expose activado,' 'Yellow'
    Escribir '  el grupo del peer permitido y "Block Inbound Connections" desactivado.' 'Yellow'
    Falla 6 'netbird expose no devolvio una URL. No se inventa una.'
  }

  # 5) Reinicio con la URL publica: los links /c/<token> y el webhook la usan.
  Escribir '  Reiniciando la app con la URL publica...'
  Detener-Proceso $script:ProcesoApp
  $script:ProcesoApp = $null
  if (-not (Esperar-PuertoLibre 15)) {
    Falla 7 ('El puerto ' + $Puerto + ' no se libero al reiniciar la app.')
  }
  $script:ProcesoApp = Iniciar-App $script:UrlPublica $LogApp2 $LogApp2Err
  if (-not (Esperar-Health 30 $script:ProcesoApp)) {
    Write-Host '  ----- log de la app -----' -ForegroundColor DarkYellow
    foreach ($archivo in @($LogApp2, $LogApp2Err)) {
      if (Test-Path -LiteralPath $archivo) { Get-Content -LiteralPath $archivo -Tail 10 }
    }
    Falla 7 ('La app no respondio en ' + $UrlLocal + ' despues del reinicio. Revisa ' + $LogApp2)
  }
  Escribir-Credenciales $script:UrlPublica $ClaveProxy 'admin@salon.local' $ClaveAdmin
  }

  # 6) Banner, portapapeles, navegador
  Mostrar-Banner $script:UrlPublica 'admin@salon.local' $ClaveAdmin

  try { Set-Clipboard -Value $script:UrlPublica | Out-Null } catch { }
  if (-not $NoAbrir) {
    try { Start-Process $script:UrlPublica | Out-Null } catch { }
  }

  Escribir '  (Ctrl + C para cortar la demo)' 'DarkGray'

  # 7) Espera activa: si algo se cae, avisa.
  $limitePrueba = $null
  if ($env:SALON_DEMO_TEST_SEGUNDOS) {
    $segundosPrueba = 0
    if ([int]::TryParse($env:SALON_DEMO_TEST_SEGUNDOS, [ref]$segundosPrueba) -and $segundosPrueba -gt 0) {
      $limitePrueba = (Get-Date).AddSeconds($segundosPrueba)
    }
  }

  while ($true) {
    Start-Sleep -Seconds 2
    if ($script:ProcesoApp -and $script:ProcesoApp.HasExited) {
      Falla 9 ('La app se detuvo (codigo ' + $script:ProcesoApp.ExitCode + '). Revisa ' + $LogApp2)
    }
    if ($script:ProcesoExpose -and $script:ProcesoExpose.HasExited) {
      Escribir ''
      Escribir '  netbird expose se detuvo: el tunel se cerro.' 'Red'
      Escribir '  ----- ultimas lineas -----' 'DarkYellow'
      $detalle = ''
      foreach ($archivo in @($LogExpose, $LogExposeErr)) {
        if (Test-Path -LiteralPath $archivo) {
          $detalle += (Get-Content -LiteralPath $archivo -Raw -ErrorAction SilentlyContinue)
          Get-Content -LiteralPath $archivo -Tail 8 | ForEach-Object { Escribir ('   ' + $_) }
        }
      }
      Escribir '  ------------------------------' 'DarkYellow'
      if ($detalle -match 'DeadlineExceeded|context deadline|public key') {
        Escribir '  NetBird perdio conexion con su Management Service (corte transitorio).' 'Yellow'
        Escribir '  1. Verifica que la PC tenga internet y que "netbird status" diga Connected.' 'Yellow'
        Escribir '  2. Volve a correr el comando.' 'Yellow'
      }
      Falla 9 'El tunel de NetBird se cerro. La demo se detuvo y limpio todo.'
    }
    if ($limitePrueba -and (Get-Date) -gt $limitePrueba) {
      Escribir '  (fin de la prueba automatica)' 'DarkGray'
      break
    }
  }
} catch {
  Escribir ''
  Escribir ('  ERROR inesperado: ' + $_.Exception.Message) 'Red'
  $codigoSalida = 1
} finally {
  # Limpieza: solo los procesos de este script.
  Detener-Proceso $script:ProcesoExpose
  Detener-Proceso $script:ProcesoApp
  $script:ProcesoExpose = $null
  $script:ProcesoApp = $null

  if (Puerto-Ocupado) {
    if (-not (Esperar-PuertoLibre 10)) {
      Escribir ('  ATENCION: el puerto ' + $Puerto + ' sigue ocupado.') 'Red'
    }
  }

  if (-not $Conservar) {
    foreach ($archivo in @($RutaDb, "$RutaDb-wal", "$RutaDb-shm", "$RutaDb-journal")) {
      if (Test-Path -LiteralPath $archivo) { Remove-Item -LiteralPath $archivo -Force -ErrorAction SilentlyContinue }
    }
    # El archivo tiene la clave en claro: se borra con la demo.
    if (Test-Path -LiteralPath $RutaCred) {
      Remove-Item -LiteralPath $RutaCred -Force -ErrorAction SilentlyContinue
    }
  }

  if ($script:Arranco) {
    Escribir ''
    if (Puerto-Ocupado) {
      $dueno = Pid-PuertoOcupado
      $quien = ''
      if ($dueno) { $quien = ' (PID ' + $dueno + ')' }
      Escribir ('  ATENCION: el puerto ' + $Puerto + ' quedo ocupado' + $quien + '.') 'Red'
      Escribir ('  Para liberarlo, en consola de administrador: Stop-Process -Id ' + $dueno + ' -Force') 'Yellow'
    } else {
      if ($UrlFija) {
        Escribir '  Demo detenida. El puerto quedo libre.' 'Green'
      } else {
        Escribir '  Demo detenida. El puerto quedo libre y el expose se cerro.' 'Green'
      }
    }
  }
}

exit $codigoSalida
