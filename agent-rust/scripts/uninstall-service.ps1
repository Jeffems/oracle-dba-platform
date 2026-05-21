$ErrorActionPreference = "Stop"
$ServiceName = "OracleDBAAgentRust"
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Execute este script como Administrador."
}
$Existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($Existing) {
  sc.exe stop $ServiceName | Out-Null
  Start-Sleep -Seconds 3
  sc.exe delete $ServiceName | Out-Null
  Write-Host "Serviço removido: $ServiceName" -ForegroundColor Green
} else {
  Write-Host "Serviço não encontrado: $ServiceName" -ForegroundColor Yellow
}
Write-Host "Os arquivos de configuração/logs foram preservados em C:\ProgramData\OracleDBAAgent."
