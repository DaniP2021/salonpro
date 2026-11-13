@echo off
setlocal
cd /d "%~dp0"

rem Abre SalonPro en Google Chrome.
rem   Doble clic        -> abre la app
rem   abrir-en-chrome probar  -> solo muestra que encontraria, sin abrir nada
rem
rem Para abrir otra direccion (por ejemplo la de Tailscale desde otra PC):
rem   set SALON_URL=http://100.95.143.50:8000

set "URL=http://127.0.0.1:8000"
if not "%SALON_URL%"=="" set "URL=%SALON_URL%"

set "EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%EXE%" set "EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%EXE%" set "EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if not exist "%EXE%" goto sinnavegador

echo.
echo   Navegador : Chrome
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
echo   No se encontro Google Chrome en las rutas habituales.
echo   Se va a abrir con el navegador predeterminado de Windows.
echo.
if /i "%~1"=="probar" exit /b 0
start "" "%URL%"
exit /b 0
