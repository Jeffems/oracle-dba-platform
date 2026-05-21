# Oracle DBA Desktop v2.6.0 — Estabilidade de Produção + Persistência Real

## O que entrou nesta versão

- API Central com PostgreSQL + Prisma
- Histórico real de métricas persistido em banco
- Tabelas para Agents, Métricas, Alertas, Comandos e Auditoria
- Health check com validação do banco
- Logs estruturados em `logs/central-api.log`
- Dashboard Web mantido com atualização em tempo real via SSE
- Sem login, RBAC ou tokens por Agent nesta etapa, conforme decisão do projeto

## Como preparar

1. Crie o banco PostgreSQL:

```sql
CREATE DATABASE oracle_dba_platform;
```

2. Copie o arquivo:

```powershell
copy .env.example .env
```

3. Ajuste a conexão no `.env`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/oracle_dba_platform?schema=public"
```

4. Instale dependências:

```powershell
npm install
```

5. Gere o Prisma Client:

```powershell
npm run db:generate
```

6. Crie as tabelas:

```powershell
npm run db:migrate
```

7. Inicie API + Dashboard:

```powershell
npm run platform:dev
```

Dashboard:

```txt
http://localhost:5174
```

API:

```txt
http://127.0.0.1:4090/health
```

## Scripts úteis

```powershell
npm run db:studio
npm run api:central
npm run dashboard:web
npm run platform:dev
```

## Próxima evolução recomendada

v2.7.0 — Instalador profissional do Agent + configuração assistida.
