@echo off
rem Espera unos segundos a que el servidor levante y abre el navegador.
rem Lo llama iniciar.cmd con el puerto como primer argumento.
if "%~1"=="" goto sinpuerto

timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:%~1/"
exit /b 0

:sinpuerto
exit /b 1
