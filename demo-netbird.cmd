@echo off
rem SalonPro - demo publica temporal con NetBird (camino B1).
rem Uso: doble clic, o desde consola:  demo-netbird.cmd -ClaveProxy "..." -NoAbrir
rem Ver docs\DEMO-NETBIRD.md

setlocal
cd /d "%~dp0"

rem -DryRun no necesita permisos; las corridas con argumentos tampoco se elevan solas.
if /i "%~1"=="-DryRun" goto ejecutar
if not "%~1"=="" goto ejecutar

rem En Windows el daemon de NetBird solo acepta administradores. Si el doble clic
rem viene de una cuenta estandar con UAC, se pide elevacion una vez.
powershell -NoProfile -Command "if(-not (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 1}"
if errorlevel 1 (
  echo.
  echo   NetBird necesita permisos de administrador.
  echo   Windows va a pedir confirmacion: elegi "Si".
  echo.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  if errorlevel 1 (
    echo   No se pudo elevar. Clic derecho en demo-netbird.cmd ^> "Ejecutar como administrador".
    pause
  )
  exit /b
)

:ejecutar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\demo-netbird.ps1" %*
set "CODIGO=%ERRORLEVEL%"

if not "%CODIGO%"=="0" (
  echo.
  echo   La demo termino con codigo %CODIGO%.
  echo   Revisa el mensaje de arriba y docs\DEMO-NETBIRD.md
  echo.
  pause
)

exit /b %CODIGO%
