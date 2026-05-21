# Build do instalador NSIS

Este projeto foi ajustado para gerar instalador NSIS pelo Tauri.

## 1. WebView2 Runtime

Baixe no site oficial da Microsoft o **Evergreen Standalone Installer x64** do Microsoft Edge WebView2 Runtime.

Salve com este nome:

```txt
src-tauri/resources/webview2/MicrosoftEdgeWebView2RuntimeInstallerX64.exe
```

> Nesta versão do ZIP, o instalador da Microsoft não foi incluído porque ele precisa ser baixado do site oficial da Microsoft. O hook NSIS já está pronto para executá-lo automaticamente se o arquivo estiver nesta pasta.

## 2. Gerar instalador

```powershell
npm install
npm run tauri:build
```

O instalador será gerado em:

```txt
src-tauri/target/release/bundle/nsis/
```

## 3. O que foi alterado

- `package.json`: removeu `assemble:portable` do `tauri:build`.
- `tauri.conf.json`: ativou `bundle` e target `nsis`.
- `src-tauri/nsis/webview2-hooks.nsi`: instala o WebView2 Runtime durante a instalação.
- `src-tauri/resources/webview2`: pasta preparada para receber o instalador WebView2.
