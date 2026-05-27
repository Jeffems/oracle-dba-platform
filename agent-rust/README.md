# Oracle DBA Agent Rust — v2.9.0

Agent Enterprise em Rust para rodar como Windows Service nativo.

## Recursos da v2.9.0

- Serviço Windows nativo, sem NSSM.
- Instalação em `C:\Program Files\OracleDBAAgent`.
- Configuração em `C:\ProgramData\OracleDBAAgent\config.json`.
- Logs em `C:\ProgramData\OracleDBAAgent\logs`.
- Heartbeat para `/api/heartbeat`.
- Envio de métricas para `/api/metrics`.
- Fila offline em `logs\queue` quando a API Central estiver indisponível.
- Restart automático configurado no Windows Service.

## Teste em console

```powershell
copy agent-rust\config.example.json agent-rust\config.json
npm run agent:rust:run
```

## Build release

```powershell
npm run agent:rust:build
```

## Instalar serviço

Abra PowerShell como Administrador:

```powershell
npm run agent:rust:build
npm run agent:rust:install
```

Depois confira:

```powershell
services.msc
Get-Service OracleDBAAgentRust
```

## Remover serviço

```powershell
npm run agent:rust:uninstall
```

## Gerar pacote distribuível do Agent

```powershell
npm run agent:rust:build
npm run agent:rust:package
```

O ZIP será criado em:

```txt
dist-agent\OracleDBAAgentRust-v2.9.0.zip
```
