@echo off
rem Instala el arranque automatico de SalonPro al iniciar sesion en Windows.
rem Doble clic y listo.
rem
rem Se ejecuta con -ExecutionPolicy Bypass porque la politica del sistema
rem puede bloquear scripts sin firma; esto solo afecta a este proceso.

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-arranque-automatico.ps1"
if errorlevel 1 (
  echo.
  echo   No se pudo instalar el arranque automatico.
  echo.
  pause
)
