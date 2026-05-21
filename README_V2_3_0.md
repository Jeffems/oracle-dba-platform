# Oracle DBA Desktop v2.3.0 - API Central

Esta versão adiciona a base da API Central para receber métricas dos Agents instalados em clientes.

## Incluído

- Página nova: **API Central**
- Servidor local em Node.js puro: `central-api/server.cjs`
- Script novo: `npm run api:central`
- Endpoints iniciais:
  - `GET /health`
  - `POST /api/metrics`
  - `GET /api/instances`
  - `GET /api/metrics`
- Autenticação inicial por Bearer Token
- Armazenamento local em JSONL para protótipo

## Como testar

Terminal 1:

```powershell
npm install
npm run api:central
```

Terminal 2:

```powershell
npm run tauri:dev
```

No app, abra o menu **API Central**.

## Observação de arquitetura

Esta v2.3.0 ainda é uma base local para desenvolvimento. Para produção, antes de usar em cliente real, implemente:

- HTTPS obrigatório
- Token individual por cliente/Agent
- Banco central real, como PostgreSQL
- Logs de auditoria
- Controle de permissões
- Fila segura de comandos para execução remota
