@echo off
setlocal
cd /d "%~dp0"
title SalonPro - red local

rem Abre la app para que se pueda usar desde el celular o desde otra PC
rem en la misma red WiFi. Escucha en todas las interfaces (0.0.0.0).

where node >nul 2>nul
if errorlevel 1 goto sinnode

set SALON_HOST=0.0.0.0
if "%SALON_PORT%"=="" set SALON_PORT=8000

echo.
echo   ==================================================
echo    SalonPro abierto a la red local
echo.
echo    En esta PC:        http://127.0.0.1:%SALON_PORT%
echo    Desde el celular:  mira la linea "http://192.168..."
echo                       que aparece abajo, y escribila
echo                       en el navegador del telefono.
echo                       (los dos en la MISMA red WiFi)
echo.
echo    IMPORTANTE: si la contrasena del administrador
echo    sigue siendo la de la demo (salon2026), cambiala
echo    en Ajustes antes de dejarlo abierto.
echo.
echo    Para detener: Ctrl + C
echo   ==================================================
echo.

node server.js
goto fin

:sinnode
echo.
echo   No se encontro Node.js.
echo   Instala Node 22.5 o superior desde https://nodejs.org
echo.
pause
exit /b 1

:fin
echo.
echo   El servidor se detuvo.
pause
