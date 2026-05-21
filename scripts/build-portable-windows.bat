@echo off
setlocal
cd /d "%~dp0\.."

echo ================================================
echo Oracle DBA Desktop - Build Portable Windows
echo ================================================

echo.
echo [1/3] Instalando dependencias se necessario...
if not exist node_modules (
  call npm install
  if errorlevel 1 exit /b 1
)

echo.
echo [2/3] Gerando bridge Oracle embutido e build Tauri...
call npm run tauri:build
if errorlevel 1 exit /b 1

echo.
echo [3/3] Build concluido.
echo Portable em: release-portable\OracleDBA
echo.
pause
