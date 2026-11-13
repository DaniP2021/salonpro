@echo off
setlocal
cd /d "%~dp0"
title SalonPro - abrir puerto en el firewall

rem Agrega la regla de firewall que permite que otros dispositivos
rem (celular, tablet, otra PC) se conecten a la app en el puerto 8000.
rem
rem Doble clic y aceptar el cartel de administrador. Nada mas.

net session >nul 2>&1
if %errorlevel%==0 goto aplicar

echo.
echo   ==================================================
echo    Se necesita permiso de administrador
echo.
echo    Va a aparecer un cartel de Windows preguntando
echo    si permitis los cambios. Eleji "Si".
echo   ==================================================
echo.
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b 0

:aplicar
echo.
echo   Agregando regla para el puerto 8000...
echo.

rem Borra la anterior si existia, para no acumular duplicados
netsh advfirewall firewall delete rule name="SalonPro" >nul 2>&1

netsh advfirewall firewall add rule name="SalonPro" dir=in action=allow protocol=TCP localport=8000
if errorlevel 1 goto fallo

echo.
echo   ==================================================
echo    Listo. La regla quedo aplicada.
echo.
echo    Proba ahora desde el celular:
echo      http://192.168.100.54:8000   (misma WiFi)
echo      http://100.95.143.50:8000    (Tailscale)
echo   ==================================================
echo.
echo   Regla vigente:
echo.
netsh advfirewall firewall show rule name="SalonPro"
echo.
pause
exit /b 0

:fallo
echo.
echo   No se pudo agregar la regla.
echo   Proba abriendo PowerShell como administrador y ejecutando:
echo.
echo     netsh advfirewall firewall add rule name="SalonPro" dir=in action=allow protocol=TCP localport=8000
echo.
pause
exit /b 1
