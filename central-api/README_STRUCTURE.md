# Central API - Estrutura Recomendada

A partir da v3.3.20, a Central API passa a separar responsabilidades para facilitar manutenção.

Estrutura alvo:

```txt
central-api/
├── server.cjs                  # Entrada da API e rotas legadas compatíveis
├── routes/
│   ├── auth.cjs                # Login, logout e sessão
│   ├── users.cjs               # Gerenciamento de usuários
│   ├── agents.cjs              # Agents/clientes
│   └── commands.cjs            # Scripts/comandos remotos
├── middleware/
│   ├── auth.cjs                # Validação de sessão/token
│   └── permissions.cjs         # Regras por perfil
├── lib/
│   ├── password.cjs            # Hash e validação de senha
│   └── http.cjs                # Helpers HTTP/CORS/JSON
└── prisma/
    └── schema.prisma
```

Nesta versão, a autenticação por banco e o gerenciamento de usuários já estão ativos no `server.cjs` para manter compatibilidade com o deploy atual. Os arquivos em `routes/`, `middleware/` e `lib/` ficam como base para a próxima divisão completa sem mudar o comportamento em produção.
