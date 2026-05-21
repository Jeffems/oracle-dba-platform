$ErrorActionPreference = "Stop"
$ServiceName = "OracleDBAAgentRust"
$DisplayName = "Oracle DBA Agent Rust"
$InstallDir = "C:\Program Files\OracleDBAAgent"
$DataDir = "C:\ProgramData\OracleDBAAgent"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$BuiltExe = Join-Path $Root "target\release\oracle-dba-agent.exe"
$SourceConfig = Join-Path $Root "config.json"
$ExampleConfig = Join-Path $Root "config.example.json"

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Execute este script como Administrador."
}
if (!(Test-Path $BuiltExe)) { throw "Executável não encontrado: $BuiltExe. Rode antes: npm run agent:rust:build" }

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "logs") | Out-Null
Copy-Item $BuiltExe (Join-Path $InstallDir "oracle-dba-agent.exe") -Force

$TargetConfig = Join-Path $DataDir "config.json"
if (!(Test-Path $TargetConfig)) {
  if (Test-Path $SourceConfig) { Copy-Item $SourceConfig $TargetConfig -Force }
  else { Copy-Item $ExampleConfig $TargetConfig -Force }
  Write-Host "Config criado em: $TargetConfig" -ForegroundColor Yellow
  Write-Host "Edite o config.json antes de iniciar em produção, se necessário." -ForegroundColor Yellow
}

$Existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($Existing) {
  Write-Host "Serviço existente encontrado. Parando e recriando..."
  sc.exe stop $ServiceName | Out-Null
  Start-Sleep -Seconds 3
  sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 3
}

$Exe = Join-Path $InstallDir "oracle-dba-agent.exe"
$BinPath = "`"$Exe`" --service --config `"$TargetConfig`""
sc.exe create $ServiceName binPath= $BinPath start= auto DisplayName= $DisplayName | Out-Host
sc.exe description $ServiceName "Oracle DBA Enterprise Agent em Rust - v2.8.0" | Out-Host
sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/300000 | Out-Host
sc.exe start $ServiceName | Out-Host
Write-Host "Serviço instalado e iniciado: $ServiceName" -ForegroundColor Green
Write-Host "Config: $TargetConfig"
Write-Host "Logs: $(Join-Path $DataDir 'logs')"
