# Central API v2.6.0 — PostgreSQL + Prisma

Esta versão troca o armazenamento em arquivos JSONL por persistência real em PostgreSQL via Prisma.

## Preparação

1. Crie um banco PostgreSQL:

```sql
CREATE DATABASE oracle_dba_platform;
```

2. Copie `.env.example` para `.env` na raiz do projeto e ajuste `DATABASE_URL`.

3. Instale e gere o Prisma:

```powershell
npm install
npm run db:generate
npm run db:migrate
```

4. Inicie a plataforma:

```powershell
npm run platform:dev
```

## Health check

```txt
http://127.0.0.1:4090/health
```

## Rotas principais

- `POST /api/agents/register`
- `POST /api/metrics`
- `GET /api/clients`
- `GET /api/metrics`
- `GET /api/alerts`
- `GET /api/alerts/history`
- `GET /api/realtime?token=...`

Autenticação continua simples por token fixo de desenvolvimento. Login/RBAC ficam para versões futuras.
