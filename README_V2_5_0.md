# Oracle DBA Desktop v2.5.0 — Alertas + Tempo Real

Esta versão evolui a v2.4.0 com:

- API Central v2.5.0
- Dashboard Web v2.5.0
- canal em tempo real via SSE (`/api/realtime`)
- status online/offline dos Agents
- alertas automáticos
- histórico de alertas em JSONL
- atualização instantânea do dashboard quando novas métricas chegam

## Rodar localmente

```powershell
npm install
npm run platform:dev
```

Dashboard:

```txt
http://localhost:5174
```

API Central:

```txt
http://127.0.0.1:4090/health
```

Token padrão de desenvolvimento:

```txt
dev-token-change-me
```

## Rotas principais

```txt
GET  /health
GET  /api/realtime?token=dev-token-change-me
POST /api/agents/register
POST /api/metrics
GET  /api/clients
GET  /api/alerts
GET  /api/alerts/history
GET  /api/metrics?limit=30
```

## Próximo passo sugerido

v2.6.0 — Execução remota controlada de scripts, com fila de comandos, aprovação, auditoria e retorno de logs pelo Agent.
