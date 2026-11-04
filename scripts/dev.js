import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const backendEnvFile = fileURLToPath(new URL('../infra/phase3/local/backend.env', import.meta.url));
const vite = fileURLToPath(new URL('../frontend/node_modules/vite/bin/vite.js', import.meta.url));
const children = new Set();
let stopping = false;

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  console.info('\n[dev] Stopping backend and frontend. Test containers remain running.');
  await Promise.all([...children].map(child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    // The Node watch process owns another Node process. Kill only our process tree.
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore', windowsHide: true,
      });
      killer.once('error', () => { child.kill(); resolve(); });
      killer.once('exit', resolve);
    } else {
      const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('exit', () => { clearTimeout(deadline); resolve(); });
      child.kill('SIGTERM');
    }
  })));
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

function launch(name, command, args, options = {}, persistent = false) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  children.add(child);
  const done = new Promise((resolve, reject) => {
    child.once('error', error => {
      children.delete(child);
      reject(new Error(`${name}: ${error.message}`));
    });
    child.once('exit', (code, signal) => {
      children.delete(child);
      if (!stopping && (persistent || code !== 0)) {
        reject(new Error(`${name} stopped (${signal || `exit ${code}`}).`));
      } else resolve();
    });
  });
  if (persistent) void done.catch(async error => {
    if (!stopping) { console.error(`[dev] ${error.message}`); await stop(1); }
  });
  return done;
}

async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is unavailable. Stop the existing server and retry.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function waitForBackend() {
  const deadline = Date.now() + 30000;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:3000/api/health', {
        signal: AbortSignal.timeout(1000),
      });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch { /* Backend preflight may still be connecting to PostgreSQL/Redis. */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  if (!stopping) throw new Error('Backend did not become healthy within 30 seconds. Check the backend output above.');
}

try {
  for (const path of [backendEnvFile, new URL('../infra/phase3/local/compose.env', import.meta.url)]) {
    if (!existsSync(path)) throw new Error('Missing local test configuration. Follow the first-time setup in README.md.');
  }
  if (!existsSync(new URL('../node_modules/express/package.json', import.meta.url)) || !existsSync(vite)) {
    throw new Error('Install dependencies first: npm ci and npm --prefix frontend ci (use npm.cmd in PowerShell).');
  }
  await Promise.all([checkPort(3000), checkPort(5173)]);
  console.info('[dev] Starting PostgreSQL test and Redis. Docker Desktop must be running.');
  await launch('Docker Compose', 'docker', [
    'compose', '--env-file', 'infra/phase3/local/compose.env',
    '-f', 'infra/phase3/compose.review.yaml', 'up', '-d', '--wait', '--wait-timeout', '90',
  ]);
  if (!stopping) {
    // Always use the isolated test config, even when this terminal has old PG/Redis variables.
    const backendEnv = { ...process.env };
    for (const name of Object.keys(backendEnv)) {
      if (/^(PG.*|WRITE_PG.*|REDIS_.*|APP_ENV_FILE|HOST|PORT|NODE_ENV|ALLOWED_ORIGINS|SESSION_SECURE)$/i.test(name)) {
        delete backendEnv[name];
      }
    }
    backendEnv.APP_ENV_FILE = backendEnvFile;
    void launch('Backend', process.execPath, ['--watch', 'src/server.js'], { env: backendEnv }, true);
    await waitForBackend();
    if (!stopping) {
      void launch('Frontend', process.execPath, [vite, '--host', '127.0.0.1', '--clearScreen', 'false'], {
        cwd: fileURLToPath(new URL('../frontend/', import.meta.url)),
      }, true);
      console.info('[dev] Backend: http://127.0.0.1:3000 | Frontend: http://127.0.0.1:5173');
      console.info('[dev] Press Ctrl+C to stop both servers.');
    }
  }
} catch (error) {
  if (!stopping) { console.error(`[dev] ${error.message}`); await stop(1); }
}
