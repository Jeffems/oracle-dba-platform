# Oracle DBA Platform

## README - Estado Atual do Projeto

### Versão: 3.3.12

**Autor:** J S Moreira

---

# Visão Geral

O Oracle DBA Platform é uma plataforma completa para administração remota de bancos Oracle, composta por:

* Desktop App (Tauri + React)
* Dashboard Web
* Central API
* Agent Windows (Rust)

A solução permite monitorar diversos clientes simultaneamente, executar comandos remotos, acompanhar métricas de desempenho e administrar bancos Oracle através de um navegador ou aplicativo desktop.

---

# Arquitetura

```
Desktop App
        │
        │ HTTPS
        ▼
Central API (Railway)
        ▲
        │ HTTPS
Dashboard Web
        │
        ▼
PostgreSQL (Railway)
        ▲
        │
Oracle DBA Agent (Rust)
        │
        ▼
Oracle Database
```

---

# Tecnologias

## Desktop

* Tauri
* React
* TypeScript
* Vite

## Dashboard

* React
* Vite

## Backend

* Node.js
* Express
* Prisma
* PostgreSQL

## Agent

* Rust

---

# Funcionalidades

## Dashboard Web

### Monitoramento em tempo real

* Clientes Online
* Clientes Offline
* Ambiente
* Sessões
* Sessões Bloqueadas
* Locks
* Tablespaces
* DB Time
* Redo
* Backup
* Última coleta

---

### Dashboard estilo Grafana

* Cards
* Indicadores
* Atualização automática
* Tema escuro
* Responsivo

---

### Modo Lista

Criado para monitoramento de grandes ambientes.

Ideal para:

* 50+
* 100+
* 200+ clientes

Mostra:

* Status
* Sessões
* Locks
* Tablespace
* Backup
* DB Time
* Redo
* Última coleta

---

### Histórico de comandos

Permite visualizar:

* comando executado
* usuário
* horário
* status

Também possui:

* botão limpar histórico

---

### Exclusão de clientes

Permite excluir um cliente através de confirmação simples.

Fluxo:

```
Tem certeza?

[Cancelar]
[Sim]
```

---

# Desktop App

## SQL Worksheet

* Execução SQL
* Resultado em tabela
* Histórico
* Cronômetro
* Botão parar execução

---

## Administração Oracle

Permite executar:

* Startup
* Shutdown
* Startup Mount
* Startup Nomount
* Alter Database Open

---

## Diretórios Oracle

Gerenciamento de:

* Data Pump
* Backup
* Diretórios Oracle

---

## Memória

Monitoramento de:

* SGA
* PGA
* ASMM
* AMM

---

## Backup

Visualização dos backups monitorados.

---

# Agent Windows

Executado como serviço Windows.

Nome:

```
OracleDBAAgent
```

Instalação automática.

---

## Localização

Executável

```
C:\Program Files\Oracle DBA Agent
```

Configuração

```
C:\ProgramData\OracleDBAAgent
```

Logs

```
C:\ProgramData\OracleDBAAgent\logs
```

---

# Configuração

config.json

Campos principais:

```
agentId

customerName

environment

apiUrl

apiToken

intervalSeconds

oracle

backupMonitor

logDir
```

---

## Oracle

```
sqlplusPath

user

password

connectString

asSysdba

localSysdba
```

Quando:

```
localSysdba=true
```

Startup e Shutdown utilizam

```
sqlplus / as sysdba
```

---

# Monitoramento

## Oracle

Coleta:

* Sessões
* Locks
* Sessões Bloqueadas
* Objetos Inválidos
* Tablespaces
* DB Time
* Redo
* CPU
* Memória Oracle

---

## Backup

Monitoramento de:

```
D:\BackupService
```

Configuração totalmente parametrizada.

São enviados:

* Último backup
* Data
* Hora
* Tamanho
* Status

---

# DB Time

O sistema utiliza cálculo por DELTA.

Não apresenta valores acumulados.

Mostra apenas:

```
DB Time/s
```

---

# Redo

Também utiliza DELTA.

Exibe:

```
Redo MB/min
```

---

# Comunicação

Desktop

↓

Central API

↓

Agent

↓

Oracle

---

# Segurança Atual

* API Token
* Comunicação HTTPS
* Agent como serviço Windows
* Execução remota controlada

---

# Melhorias Planejadas

## Segurança

Reautenticação para comandos críticos.

Antes de executar:

* Startup
* Shutdown
* Alter System
* Drop
* Truncate
* Delete sem WHERE
* Kill Session

o sistema solicitará login novamente.

---

## Dashboard

* Health Score
* Alertas Inteligentes
* Gráficos avançados
* Dashboard NOC
* Filtros avançados

---

## Agent

* Auto Update
* Configuração remota
* Sincronização automática
* Monitoramento de disco
* Monitoramento de CPU do servidor
* Monitoramento de memória do servidor

---

## Plataforma

Objetivo:

Transformar o Oracle DBA Platform em uma solução profissional de monitoramento Oracle capaz de administrar centenas de bancos Oracle simultaneamente através de uma única interface Web, mantendo agentes leves instalados nos clientes e gerenciamento centralizado pela Central API.
