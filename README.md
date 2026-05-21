# Oracle DBA Desktop

Ferramenta desktop para administração Oracle DBA.

## Módulos disponíveis

Módulos disponíveis na navegação principal:

1. Memória
2. Usuários
3. Tablespaces
4. Expandir Datafiles
5. Importação / Exportação
6. Sessões e Locks
7. Diagnóstico
8. ERP Presets
9. Patch Temporário
10. SQL Worksheet



## Rodar em desenvolvimento

```bash
npm install
npm run oracle:bridge
```

Em outro terminal:

```bash
npm run tauri:dev
```

## Observações

- Aplicação desktop com interface moderna.
- O acesso Oracle usa o bridge Node em `backend/node/oracle-bridge.ts` com `oracledb`.
- Se houver erro de Oracle Client, instale o Oracle Instant Client e adicione ao PATH.
- Se a porta 1420 estiver ocupada, finalize o processo em uso ou reinicie o terminal.

## v2.2.0 - Agent Coletor Local

Esta versão adiciona o módulo Agent Coletor Local. Ele coleta métricas do Oracle 19 em intervalo configurável e salva histórico local em JSONL.

Para testar:

```powershell
npm install
npm run tauri:dev
```

Para gerar instalador:

```powershell
npm run tauri:build
```


## v2.3.0 - API Central

Consulte `README_V2_3_0.md` e `central-api/README.md`.

## v2.4.0 — API Central + Dashboard Web

Consulte `README_V2_4_0.md` para rodar a API Central e o Dashboard Web.

Comandos principais:

```powershell
npm run api:central
npm run dashboard:web
npm run platform:dev
```


## v2.5.0
Veja `README_V2_5_0.md` para Alertas + Tempo Real.


---

## v2.6.0 — Estabilidade de Produção + Persistência Real

Veja `README_V2_6_0.md`.

Comandos principais:

```powershell
copy .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run platform:dev
```


## v2.7.0 — Agent Enterprise Rust

Veja `README_V2_7_0.md` e a pasta `agent-rust/`.
