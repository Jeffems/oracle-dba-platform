# Oracle DBA Desktop v2.4.0 — API Central + Dashboard Web

Esta versão adiciona uma base de plataforma para monitoramento remoto de múltiplos clientes.

## Incluído

- API Central v2.4.0 em `central-api/server.cjs`
- Dashboard Web em `dashboard-web/`
- Registro básico de Agents
- Recebimento de métricas via token
- Listagem de clientes/instâncias
- Alertas simples por comunicação, locks e tablespace
- Fila segura de scripts para auditoria futura
- App Tauri mantido com Oracle Bridge e Agent 404 fix

## Rodar API Central

```powershell
npm run api:central
```

API local:

```txt
http://127.0.0.1:4090
```

Token padrão:

```txt
dev-token-change-me
```

## Rodar Dashboard Web

Primeira vez:

```powershell
cd dashboard-web
npm install
npm run dev
```

Acesse:

```txt
http://localhost:5174
```

## Rodar tudo junto

Na raiz do projeto:

```powershell
npm run platform:dev
```

## Teste rápido enviando métrica fake

```powershell
$body = @{
  agentId = "CLIENTE_001"
  customerName = "Cliente Teste"
  host = "SRV-ORACLE"
  dbName = "ORCL19"
  snapshot = @{
    host = "SRV-ORACLE"
    overview = @(
      @{ METRIC = "ACTIVE_SESSIONS"; VALUE = 7 },
      @{ METRIC = "BLOCKED_SESSIONS"; VALUE = 0 },
      @{ METRIC = "TABLESPACE_MAX_USED_PCT"; VALUE = 72 }
    )
  }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:4090/api/metrics" `
  -Headers @{ Authorization = "Bearer dev-token-change-me" } `
  -ContentType "application/json" `
  -Body $body
```

## Próxima versão sugerida

`v2.5.0` — Agent conectado à API Central com token individual por cliente e envio automático das métricas reais.
