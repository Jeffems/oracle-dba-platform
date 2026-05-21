@echo off
cd /d "%~dp0"
echo Gerando versao portable...
call npm run dist:portable
if errorlevel 1 goto :erro

echo.
echo Build concluido. Verifique a pasta dist.
pause
exit /b 0

:erro
echo.
echo Ocorreu um erro durante o build.
pause
exit /b 1
