# Oracle DBA Desktop v2.1.0

Versão preparada com a primeira base de monitoramento e manutenção assistida para Oracle 19 em produção.

## Novidades

- Novo módulo **Performance Oracle** com dashboard inicial para:
  - sessões ativas;
  - sessões bloqueadas;
  - locks;
  - objetos inválidos;
  - maior uso de tablespace;
  - operações longas;
  - wait events;
  - top SQL por tempo decorrido.
- Novo módulo **Manutenção Assistida** com scripts seguros de diagnóstico e geração de comandos.
- Novo módulo **Agent Coletor** com arquitetura planejada para serviço Windows em background.
- Mantida a inicialização automática do Oracle Bridge.
- Mantida a estrutura para instalador NSIS com WebView2.

## Build

```powershell
npm install
npm run tauri:build
```

O instalador deve ser gerado em:

```txt
src-tauri\target\release\bundle\nsis\
```

## Observação

O módulo Agent Coletor nesta versão é a base visual/documental da arquitetura. A implementação do serviço Windows pode ser feita na v2.2.0.
