# Oracle DBA Platform v2.8.0 — Agent Enterprise Operacional

Esta versão prepara o Agent Rust para operação mais próxima de produção.

## Principais mudanças

- Agent Rust atualizado para `2.8.0-rust`.
- API Central atualizada para `2.8.0`.
- Nova rota `POST /api/heartbeat`.
- Agent envia heartbeat periódico.
- Agent grava fila offline quando a API estiver indisponível.
- Script de instalação do serviço copia arquivos para `C:\Program Files\OracleDBAAgent`.
- Config e logs ficam em `C:\ProgramData\OracleDBAAgent`.
- Serviço Windows configurado com restart automático em falha.
- Script para gerar ZIP distribuível do Agent.

## Rodar plataforma

```powershell
copy .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run platform:dev
```

## Testar Agent Rust

```powershell
copy agent-rust\config.example.json agent-rust\config.json
npm run agent:rust:run
```

## Instalar Agent como serviço

PowerShell como Administrador:

```powershell
npm run agent:rust:build
npm run agent:rust:install
```

## Gerar pacote do Agent para cliente

```powershell
npm run agent:rust:build
npm run agent:rust:package
```
