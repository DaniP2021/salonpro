@echo off
setlocal
cd /d "%~dp0"
title SalonPro

where node >nul 2>nul
if errorlevel 1 goto sinnode

for /f "tokens=1 delims=." %%v in ('node -v') do set VERSIONNODE=%%v
set VERSIONNODE=%VERSIONNODE:v=%
if %VERSIONNODE% LSS 22 goto nodeviejo

if /i "%~1"=="demo" (
  echo.
  echo   Cargando datos de demostracion...
  echo.
  set SALON_DESPACHO=0
  node scripts\seed.js --si
  if errorlevel 1 goto falloseed
  set SALON_DESPACHO=1
)

if "%SALON_PORT%"=="" set SALON_PORT=8000

echo.
echo   ============================================
echo    SalonPro se esta abriendo en el navegador
echo.
echo    Direccion:   http://127.0.0.1:%SALON_PORT%
echo    Entrar con:  admin@salon.local / salon2026
echo    Para detener: Ctrl + C
echo   ============================================
echo.
echo   Si el navegador no se abre solo, escribi en la barra
echo   de direcciones exactamente esto:  127.0.0.1:%SALON_PORT%
echo.

rem Abre el navegador 3 segundos despues, sin bloquear este proceso.
start "" /min "%~dp0abrir-navegador.cmd" %SALON_PORT%

node server.js
goto fin

:sinnode
echo.
echo   No se encontro Node.js.
echo   Instala Node 22.5 o superior desde https://nodejs.org
echo.
pause
exit /b 1

:nodeviejo
echo.
echo   La version de Node instalada es demasiado vieja.
echo   Esta app necesita Node 22.5 o superior: https://nodejs.org
echo.
pause
exit /b 1

:falloseed
echo.
echo   Fallo la carga de datos de demostracion.
echo.
pause
exit /b 1

:fin
echo.
echo   El servidor se detuvo.
pause
