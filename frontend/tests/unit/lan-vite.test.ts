import { expect, it, vi } from 'vitest';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createProbe } from 'node:net';
import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { lanApiPattern } from '../../config/lan';

it('actual LAN Vite config compiles relative API URLs, proxies JWT requests and blocks env files', async () => {
  vi.stubEnv('LAN_TEST_HOST', '127.0.0.1'); vi.stubEnv('VITE_API_URL', 'http://localhost:3000/api');
  let jwt: string | undefined; let path: string | undefined; let vite: ViteDevServer | undefined;
  const backend = createHttpServer((req, res) => { jwt = req.headers.authorization; path = req.url; res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); });
  const probeName = `.env.test-lan-${process.pid}-${Date.now()}`;
  const probeFile = fileURLToPath(new URL(`../../${probeName}`, import.meta.url));
  let probeCreated = false;
  try {
    // Test denial of an existing synthetic env file, including on clean CI.
    // The real .env is never created, overwritten or read by this test.
    writeFileSync(probeFile, 'SYNTHETIC_DENY_PROBE=not-a-secret\n', { flag: 'wx' });
    probeCreated = true;
    await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve));
    const address = backend.address(); if (!address || typeof address === 'string') throw Error('QA backend unavailable');
    const probe = createProbe(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const free = probe.address(); if (!free || typeof free === 'string') throw Error('QA frontend port unavailable');
    const port = free.port; await new Promise<void>(resolve => probe.close(() => resolve()));
    vite = await createViteServer({ configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)), mode: 'lan',
      root: fileURLToPath(new URL('../../', import.meta.url)), cacheDir: mkdtempSync(join(tmpdir(), 'warehouse-lan-vite-')), logLevel: 'silent',
      server: { port, proxy: { [lanApiPattern]: { target: `http://127.0.0.1:${address.port}`, changeOrigin: true } } } });
    await vite.listen();
    const front = vite.httpServer!.address(); if (!front || typeof front === 'string') throw Error('QA frontend unavailable');
    const base = `http://127.0.0.1:${front.port}`;
    const transformed = (await vite.transformRequest('/src/lib/backend-api.ts'))!.code;
    expect(/(?:"VITE_API_URL"\s*:\s*"\/api"|apiUrl\s*=\s*\("\/api")/.test(transformed)).toBe(true);
    const response = await fetch(`${base}/api/transactions?movementType=OUT`, { headers: { Authorization: 'Bearer qa-proxy-token' } });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
    expect(path).toBe('/api/transactions?movementType=OUT'); expect(jwt).toBe('Bearer qa-proxy-token');
    expect((await fetch(`${base}/${probeName}`)).status).toBe(403);
    expect(vite.config.server.host).toBe('127.0.0.1');
  } finally {
    await vite?.close(); backend.closeAllConnections(); await new Promise<void>(resolve => backend.close(() => resolve())); vi.unstubAllEnvs();
    if (probeCreated) unlinkSync(probeFile);
  }
}, 30000);
