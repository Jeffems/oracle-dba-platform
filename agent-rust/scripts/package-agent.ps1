$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$ProjectRoot = Resolve-Path (Join-Path $Root "..")
$Exe = Join-Path $Root "target\release\oracle-dba-agent.exe"
$OutDir = Join-Path $ProjectRoot "dist-agent\OracleDBAAgentRust-v2.9.0"
if (!(Test-Path $Exe)) { throw "Executável não encontrado: $Exe. Rode antes: npm run agent:rust:build" }
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir "scripts") | Out-Null
Copy-Item $Exe (Join-Path $OutDir "oracle-dba-agent.exe") -Force
Copy-Item (Join-Path $Root "config.example.json") (Join-Path $OutDir "config.example.json") -Force
Copy-Item (Join-Path $Root "README.md") (Join-Path $OutDir "README.md") -Force
Copy-Item (Join-Path $Root "scripts\install-service.ps1") (Join-Path $OutDir "scripts\install-service.ps1") -Force
Copy-Item (Join-Path $Root "scripts\uninstall-service.ps1") (Join-Path $OutDir "scripts\uninstall-service.ps1") -Force
$Zip = "$OutDir.zip"
if (Test-Path $Zip) { Remove-Item -Force $Zip }
Compress-Archive -Path "$OutDir\*" -DestinationPath $Zip -Force
Write-Host "Pacote do Agent gerado: $Zip" -ForegroundColor Green
