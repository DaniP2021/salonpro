@echo off
setlocal
cd /d "%~dp0"

rem Abre SalonPro en Microsoft Edge.
rem   Doble clic        -> abre la app
rem   abrir-en-edge probar  -> solo muestra que encontraria, sin abrir nada
rem
rem Para abrir otra direccion (por ejemplo la de Tailscale desde otra PC):
rem   set SALON_URL=http://100.95.143.50:8000

set "URL=http://127.0.0.1:8000"
if not "%SALON_URL%"=="" set "URL=%SALON_URL%"

set "EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EXE%" set "EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if not exist "%EXE%" goto sinnavegador

echo.
echo   Navegador : Microsoft Edge
echo   Programa  : %EXE%
echo   Direccion : %URL%
echo.

if /i "%~1"=="probar" (
  echo   [modo prueba] no se abre el navegador.
  echo.
  exit /b 0
)

start "" "%EXE%" --new-window "%URL%"
exit /b 0

:sinnavegador
echo.
echo   No se encontro Microsoft Edge en las rutas habituales.
echo   Se va a abrir con el navegador predeterminado de Windows.
echo.
if /i "%~1"=="probar" exit /b 0
start "" "%URL%"
exit /b 0
