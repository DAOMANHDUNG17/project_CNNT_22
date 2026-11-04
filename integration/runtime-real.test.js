import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { fork } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startSecureServer } from './support/secure.js';

test('server.js starts with APP_ENV_FILE for the isolated test environment and requires authentication', async t => {
  // Reuse the cluster/marker/role checks before starting the actual entry point.
  await startSecureServer(t);
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const envFile = fileURLToPath(new URL('../infra/phase3/local/backend.env', import.meta.url));
  const testEnv = parseEnv(readFileSync(envFile, 'utf8'));
  let diagnostics = '', exit;
  const child = fork(fileURLToPath(new URL('../src/server.js', import.meta.url)), [], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, ...testEnv, APP_ENV_FILE: envFile, PORT: String(port) },
    stdio: ['ignore','pipe','pipe','ipc'], windowsHide: true,
  });
  child.stdout.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000); });
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000); });
  child.on('exit', code => { exit = code; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise(resolve => child.once('exit', resolve));
      child.kill(); await stopped;
    }
  });
  const base = `http://127.0.0.1:${port}/api`;
  let ready = false;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && exit === undefined) {
    try {
      const response = await fetch(base + '/health', { signal: AbortSignal.timeout(500) });
      if (response.status === 200) { ready = true; break; }
    } catch { /* wait for the real startup preflight */ }
    await delay(100);
  }
  assert.ok(ready, `Entry point must become ready; exit=${exit}; diagnostics=${diagnostics}`);
  assert.equal((await fetch(base + '/products')).status, 401);
  assert.match(diagnostics, /API listening/u);
});
