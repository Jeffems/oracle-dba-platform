const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist-bridge');
const resourceDir = path.join(root, 'src-tauri', 'resources', 'oracle-bridge');
const compiledJs = path.join(distDir, 'backend', 'node', 'oracle-bridge.js');
const bridgeCjs = path.join(resourceDir, 'oracle-bridge.cjs');
const nodeRuntimeName = process.platform === 'win32' ? 'node-runtime.exe' : 'node-runtime';
const nodeRuntimeOut = path.join(resourceDir, nodeRuntimeName);

function run(command) {
  console.log(`\n> ${command}`);
  execSync(command, { cwd: root, stdio: 'inherit', shell: true });
}

function ensureDependencies() {
  const typescriptBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const tauriCli = path.join(root, 'node_modules', '@tauri-apps', 'cli');

  if (!fs.existsSync(typescriptBin) || !fs.existsSync(viteBin) || !fs.existsSync(tauriCli)) {
    console.log('\nDependências não encontradas. Executando npm install...');
    run('npm install');
  }
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

ensureDependencies();

fs.rmSync(distDir, { recursive: true, force: true });
fs.rmSync(resourceDir, { recursive: true, force: true });
fs.mkdirSync(resourceDir, { recursive: true });

run('node ./node_modules/typescript/bin/tsc -p tsconfig.bridge.json');

if (!fs.existsSync(compiledJs)) {
  throw new Error(`Bridge compilado não encontrado: ${compiledJs}`);
}

const compiledCode = fs.readFileSync(compiledJs, 'utf8');
const bootstrap = `process.on('uncaughtException', (err) => { console.error('[FATAL uncaughtException]', err && (err.stack || err.message) || err); process.exit(1); });
process.on('unhandledRejection', (err) => { console.error('[FATAL unhandledRejection]', err && (err.stack || err.message) || err); process.exit(1); });
console.log('[BOOT] Oracle Bridge iniciando em', new Date().toISOString());
`;
fs.writeFileSync(bridgeCjs, bootstrap + compiledCode, 'utf8');

const oracleDbSrc = path.join(root, 'node_modules', 'oracledb');
const oracleDbDest = path.join(resourceDir, 'node_modules', 'oracledb');
if (!fs.existsSync(oracleDbSrc)) {
  throw new Error('Dependência node_modules/oracledb não encontrada. Execute npm install antes do build.');
}
copyDir(oracleDbSrc, oracleDbDest);

fs.copyFileSync(process.execPath, nodeRuntimeOut);
if (process.platform !== 'win32') {
  fs.chmodSync(nodeRuntimeOut, 0o755);
}

fs.writeFileSync(
  path.join(resourceDir, 'README.txt'),
  'Oracle Bridge embutido. Este diretório é usado automaticamente pelo OracleDBA.exe.\nNão execute manualmente.\n',
  'utf8'
);

console.log(`\nNode runtime copiado: ${nodeRuntimeOut}`);
console.log(`Oracle Bridge gerado: ${bridgeCjs}`);
console.log('Bridge pronto para inicialização automática pelo Tauri.');
