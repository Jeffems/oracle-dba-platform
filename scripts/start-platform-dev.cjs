const { spawn } = require('node:child_process');

function run(name, cmd, args, cwd = process.cwd()) {
  const child = spawn(cmd, args, { cwd, shell: true, stdio: 'pipe' });
  child.stdout.on('data', d => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', d => process.stderr.write(`[${name}] ${d}`));
  child.on('exit', code => console.log(`[${name}] finalizado com código ${code}`));
  return child;
}

const api = run('api-central', 'node', ['central-api/server.cjs']);
const dashboard = run('dashboard-web', 'npm', ['--prefix', 'dashboard-web', 'run', 'dev']);

process.on('SIGINT', () => {
  api.kill();
  dashboard.kill();
  process.exit(0);
});
