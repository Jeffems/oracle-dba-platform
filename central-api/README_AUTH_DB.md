# Oracle DBA Platform v3.3.19 - Autenticação por Banco de Dados

Esta versão troca o login fixo por `.env` para autenticação baseada no PostgreSQL da Central API.

## Arquivos alterados

```txt
central-api/server.cjs
central-api/prisma/schema.prisma
central-api/.env.example
README_AUTH_DB.md
```

## O que muda

- Novo model Prisma: `DashboardUser`.
- Login do Dashboard valida usuário e senha no banco.
- Senha armazenada como hash `scrypt`, nunca em texto puro.
- Primeiro usuário ADMIN é criado automaticamente quando a tabela estiver vazia.
- Sessão mantém `username`, `role` e `userId`.
- Rotas novas para administração básica de usuários:
  - `GET /api/users`
  - `POST /api/users`
  - `PATCH /api/users/:id`

## Variáveis no Railway da Central API

Use estas variáveis apenas para criar o primeiro usuário quando ainda não existir nenhum usuário no banco:

```env
DASHBOARD_ADMIN_USER=admin
DASHBOARD_ADMIN_PASSWORD=sua-senha-forte
DASHBOARD_SESSION_SECRET=um-segredo-grande
DASHBOARD_SESSION_TTL_MS=28800000
```

Depois que o primeiro usuário for criado, o login passa a depender do banco. Alterar `DASHBOARD_ADMIN_PASSWORD` não muda a senha de usuários já existentes.

## Comandos para aplicar

Na pasta `central-api`:

```bash
npm install
npx prisma generate
npx prisma db push
npm start
```

No Railway, garanta que o deploy execute o `prisma db push` ou rode manualmente uma vez. Sem isso, a tabela `DashboardUser` não existirá.

## Criar usuário via API

Depois de logar como ADMIN, é possível criar novos usuários:

```http
POST /api/users
Authorization: Bearer <token_do_dashboard>
Content-Type: application/json

{
  "username": "jeferson",
  "password": "senha-forte-123",
  "role": "DBA",
  "active": true
}
```

Perfis sugeridos:

```txt
ADMIN
DBA
OPERADOR
READONLY
```
