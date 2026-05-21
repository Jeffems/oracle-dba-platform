const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'src-tauri', 'target', 'release');
const portableDir = path.join(root, 'release-portable', 'OracleDBA');
const resourceSrc = path.join(root, 'src-tauri', 'resources', 'oracle-bridge');

const exeCandidates = [
  'oracle-dba-desktop.exe',
  'oracle-dba-desktop',
  'Oracle DBA Desktop.exe',
  'Oracle DBA Desktop'
];

const exeName = exeCandidates.find((name) => fs.existsSync(path.join(releaseDir, name)));

fs.rmSync(portableDir, { recursive: true, force: true });
fs.mkdirSync(portableDir, { recursive: true });
fs.mkdirSync(path.join(portableDir, 'logs'), { recursive: true });
fs.mkdirSync(path.join(portableDir, 'config'), { recursive: true });
fs.mkdirSync(path.join(portableDir, 'instantclient'), { recursive: true });

if (exeName) {
  fs.copyFileSync(path.join(releaseDir, exeName), path.join(portableDir, exeName));
} else {
  console.warn('Executável Tauri não encontrado em src-tauri/target/release. Rode npm run tauri:build primeiro.');
}

if (fs.existsSync(resourceSrc)) {
  fs.cpSync(resourceSrc, path.join(portableDir, 'oracle-bridge'), { recursive: true });
  // Também deixa o bridge ao lado do EXE em target/release para teste direto sem montar portable.
  fs.rmSync(path.join(releaseDir, 'oracle-bridge'), { recursive: true, force: true });
  fs.cpSync(resourceSrc, path.join(releaseDir, 'oracle-bridge'), { recursive: true });
}

fs.writeFileSync(
  path.join(portableDir, 'README_PORTABLE.txt'),
  [
    'Oracle DBA Desktop - Portable',
    '',
    '1. Abra o executável principal.',
    '2. O Oracle Bridge inicia automaticamente.',
    '3. Se usar Oracle Instant Client, coloque os arquivos em instantclient/ ou configure o PATH do Windows.',
    '4. Logs ficam em logs/.',
    '',
    'Criado por J S Moreira',
    ''
  ].join('\n'),
  'utf8'
);

console.log(`Portable montado em: ${portableDir}`);
