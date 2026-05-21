# Oracle DBA Desktop v2.2.0

## Novidades

- Agent Coletor Local no módulo **Agent Coletor**.
- Coleta periódica de métricas do Oracle 19:
  - sessões ativas;
  - sessões bloqueadas;
  - locks em espera;
  - objetos inválidos;
  - maior uso de tablespace;
  - operações longas;
  - principais wait events;
  - top SQL por tempo decorrido.
- Histórico local em JSONL salvo em:

```txt
src-tauri/resources/oracle-bridge/agent-data/metrics.jsonl
```

ou na pasta `agent-data` ao lado do bridge em execução.

## Como testar em desenvolvimento

```powershell
npm install
npm run tauri:dev
```

A partir da v2.2.0, o comando `tauri:dev` já executa `build:bridge` automaticamente antes de abrir o Tauri.

## Como gerar instalador

```powershell
npm run tauri:build
```

O instalador NSIS será gerado em:

```txt
src-tauri\target\release\bundle\nsis\
```

## Observações importantes

Esta versão implementa o Agent local dentro do Oracle Bridge. Ele coleta e grava métricas enquanto o aplicativo/bridge estiver rodando.

A próxima evolução recomendada é a v2.3.0 com envio para API central, autenticação por token e dashboard histórico multi-servidor.
