import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCloudEnvironment } from './lib/cloud-environment.js';
import { readCloudConfig } from '../src/config/cloud.js';
import { assertCloudReleaseReady } from '../src/cloud/release-gate.js';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const selected = loadCloudEnvironment();
  const config = readCloudConfig(selected);
  assertCloudReleaseReady(); // No Docker, migration, seed or child process before release review.
  const backend = spawn(process.execPath, ['src/cloud/server.js'], { cwd: root, env: selected, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  let frontend, stopping = false;
  const deadline = setTimeout(() => { console.error('Cloud startup timed out.'); stop(1); }, 30000);
  function stop(code = 0) {
    if (stopping) return;
    stopping = true; clearTimeout(deadline); process.exitCode = code;
    frontend?.kill('SIGTERM');
    if (backend.connected) backend.send('shutdown');
    else backend.kill('SIGTERM');
    setTimeout(() => backend.kill('SIGTERM'), 10000).unref();
  }
  backend.once('message', message => {
    if (message?.type !== 'ready' || stopping) return;
    clearTimeout(deadline);
    // Never pass the selected Cloud file or arbitrary VITE_* / DB / Auth secrets to Vite.
    const env = {};
    for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT', 'USERPROFILE']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    Object.assign(env, config.frontend);
    frontend = spawn(process.execPath, ['frontend/node_modules/vite/bin/vite.js', '--config', 'frontend/vite.config.ts', 'frontend'], { cwd: root, env, stdio: 'inherit' });
    frontend.once('error', () => { console.error('Frontend failed to start. Run npm install first.'); stop(1); });
    frontend.once('exit', code => stop(code ?? 1));
  });
  backend.once('error', () => { console.error('Cloud backend failed to start.'); stop(1); });
  backend.once('exit', code => stop(code ?? 1));
  process.once('SIGINT', () => stop());
  process.once('SIGTERM', () => stop());
} catch (error) { console.error(error.message); process.exitCode = 1; }
