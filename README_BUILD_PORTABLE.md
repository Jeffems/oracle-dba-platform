# Build Portable - Oracle DBA Desktop

## Comando recomendado

```bash
npm install
npm run tauri:build
```

O build agora foi ajustado para gerar uma versão portable por pasta, sem depender de instalador NSIS/WiX.

## Saída esperada

```txt
release-portable/OracleDBA/
```

Dentro dessa pasta ficam:

```txt
oracle-dba-desktop.exe
oracle-bridge/
logs/
config/
instantclient/
README_PORTABLE.txt
```

## Oracle Bridge

O Oracle Bridge é iniciado automaticamente pelo executável Tauri.

Não é mais necessário executar manualmente:

```bash
npm run oracle:bridge
```

## Oracle Instant Client

Se a conexão Oracle exigir Instant Client local, coloque os arquivos em:

```txt
release-portable/OracleDBA/instantclient/
```

ou configure o PATH do Windows apontando para o Instant Client.

## Caso dê erro de Rust/Cargo

Instale ou corrija o Rust:

```bash
rustup default stable
rustup update
```

Confirme:

```bash
cargo --version
rustc --version
```

## Caso dê erro de WebView2

Instale o Microsoft Edge WebView2 Runtime.

## Observação importante

Use sempre:

```bash
npm run tauri:build
```

Não use apenas `tauri build`, porque o comando completo também gera o bridge embutido e monta a pasta portable.

Criado por J S Moreira
