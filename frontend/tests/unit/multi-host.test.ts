import { expect, it } from 'vitest';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devUrl, startDev } from '../../config/multi-host';

function listen(server: Server, host: string, port = 0) {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No TCP address'));
      resolve(address.port);
    });
  });
}

function close(server: Server) {
  return new Promise<void>(resolve => server.close(() => resolve()));
}

function hotMessage(socket: WebSocket, type: string) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Missing HMR ${type} message`)); }, 5000);
    const receive = (event: MessageEvent) => {
      if (JSON.parse(String(event.data)).type === type) { cleanup(); resolve(); }
    };
    const fail = () => { cleanup(); reject(new Error('HMR socket failed')); };
    function cleanup() { clearTimeout(timer); socket.removeEventListener('message', receive); socket.removeEventListener('error', fail); }
    socket.addEventListener('message', receive);
    socket.addEventListener('error', fail);
  });
}

it('shares HTTP, relative API auth and HMR on three addresses, then releases all listeners', async () => {
  const calls: { path: string | undefined; jwt: string | undefined }[] = [];
  const backend = createHttpServer((req, res) => {
    calls.push({ path: req.url, jwt: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}');
  });
  const backendPort = await listen(backend, '127.0.0.1');
  let dev: Awaited<ReturnType<typeof startDev>> | undefined;
  const sockets: WebSocket[] = [];
  const probeName = `.env.test-multi-${process.pid}-${Date.now()}`;
  const probeFile = fileURLToPath(new URL(`../../${probeName}`, import.meta.url));
  let probeCreated = false;
  try {
    // A real, credential-free file makes this check meaningful on clean clones.
    // Never create, overwrite or read the developer's actual .env.
    writeFileSync(probeFile, 'SYNTHETIC_DENY_PROBE=not-a-secret\n', { flag: 'wx' });
    probeCreated = true;
    // Pass a concrete free port: Vite can fall back to configured 5173 for 0,
    // which would collide with the developer's frontend outside this test.
    const probe = createServer();
    const frontendPort = await listen(probe, '127.0.0.1');
    await close(probe);
    dev = await startDev({ port: frontendPort, hosts: ['127.0.0.2', '127.0.0.3'],
      apiTarget: `http://127.0.0.1:${backendPort}`, cacheDir: mkdtempSync(join(tmpdir(), 'warehouse-multi-host-')), logLevel: 'silent' });
    expect(dev.hosts).toEqual(['127.0.0.1', '127.0.0.2', '127.0.0.3']);
    for (const host of dev.hosts) {
      const base = devUrl(host, dev.port);
      expect((await fetch(base)).status).toBe(200);
      const response = await fetch(`${base}api/transactions?movementType=OUT`, { headers: { Authorization: 'Bearer fixture-multi-host' } });
      expect(await response.json()).toEqual({ ok: true });
      expect((await fetch(`${base}${probeName}`)).status).toBe(403);
      const socket = new WebSocket(`${base.replace('http:', 'ws:')}?token=${dev.vite.config.webSocketToken}`, 'vite-hmr');
      sockets.push(socket);
      await hotMessage(socket, 'connected');
    }
    expect(calls).toEqual(dev.hosts.map(() => ({ path: '/api/transactions?movementType=OUT', jwt: 'Bearer fixture-multi-host' })));
    const transformed = (await dev.vite.transformRequest('/src/lib/backend-api.ts'))!.code;
    expect(/(?:"VITE_API_URL"\s*:\s*"\/api"|apiUrl\s*=\s*\("\/api")/.test(transformed)).toBe(true);
    const broadcast = sockets.map(socket => hotMessage(socket, 'custom'));
    dev.vite.ws.send({ type: 'custom', event: 'multi-host-qa', data: { ok: true } });
    await Promise.all(broadcast);
    await dev.close();
    for (const host of dev.hosts) {
      const probe = createServer();
      await listen(probe, host, dev.port);
      await close(probe);
    }
  } finally {
    sockets.forEach(socket => socket.close());
    await dev?.close();
    if (probeCreated) unlinkSync(probeFile);
    backend.closeAllConnections();
    await close(backend);
  }
}, 30000);

it('rolls back its listeners if a LAN port is occupied and keeps the existing server running', async () => {
  const existing = createServer();
  const port = await listen(existing, '127.0.0.3');
  try {
    await expect(startDev({ port, hosts: ['127.0.0.2', '127.0.0.3'],
      cacheDir: mkdtempSync(join(tmpdir(), 'warehouse-multi-conflict-')), logLevel: 'silent' })).rejects.toThrow('Stop the old frontend');
    expect(existing.listening).toBe(true);
    for (const host of ['127.0.0.1', '127.0.0.2']) {
      const probe = createServer();
      await listen(probe, host, port);
      await close(probe);
    }
  } finally { await close(existing); }
}, 30000);
