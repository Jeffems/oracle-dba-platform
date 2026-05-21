# v2.7.0 — Agent Enterprise Rust

Esta versão adiciona um novo Agent em Rust para uso em produção, rodando em paralelo ao Agent Node atual.

## O que foi incluído

- `agent-rust/` com projeto Cargo completo.
- Agent nativo em Rust.
- Execução em console para testes.
- Instalação como Windows Service usando `sc.exe`.
- Coleta básica de métricas Oracle via SQLPlus.
- Envio para a API Central `/api/metrics`.
- Logs rotativos em arquivo.
- Reconexão automática por loop de coleta.

## Por que manter em paralelo?

O Agent Node/NSSM continua funcionando. O Agent Rust entra como substituto gradual, para validar em ambiente real sem interromper o monitoramento atual.

## Como testar localmente

1. Suba a API Central:

```powershell
npm run platform:dev
```

2. Configure o Agent Rust:

```powershell
copy agent-rust\config.example.json agent-rust\config.json
notepad agent-rust\config.json
```

3. Rode em modo console:

```powershell
npm run agent:rust:run
```

## Como compilar

```powershell
npm run agent:rust:build
```

## Como instalar como serviço

Execute PowerShell como administrador:

```powershell
npm run agent:rust:build
npm run agent:rust:install
```

Serviço criado:

```txt
OracleDBAAgentRust
```

## Remover serviço

```powershell
npm run agent:rust:uninstall
```

## Requisitos no servidor do cliente

- Oracle Client/Instant Client com SQLPlus.
- Permissão para conectar no Oracle.
- Acesso de saída para a API Central.

## Próximo passo recomendado

v2.8.0 — Instalador profissional do Agent Rust, com wizard para configurar cliente, banco, API e serviço Windows.
