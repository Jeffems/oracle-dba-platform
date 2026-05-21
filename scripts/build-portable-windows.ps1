$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "================================================"
Write-Host "Oracle DBA Desktop - Build Portable Windows"
Write-Host "================================================"

if (!(Test-Path "node_modules")) {
  Write-Host "Instalando dependencias..."
  npm install
}

Write-Host "Gerando bridge Oracle embutido e build Tauri..."
npm run tauri:build

Write-Host "Build concluido. Portable em: release-portable\OracleDBA"
