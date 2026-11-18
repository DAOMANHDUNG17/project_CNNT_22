import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer as createHttpServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer as createViteServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { lanApiPattern, lanServerOptions, lanTlsDenyFiles } from '../../config/lan';

describe('real HTTP/HTTPS proxy transport using isolated QA servers', () => {
  const requests: { url: string; authorization: string | undefined; method: string | undefined; body: string }[] = [];
  const backend = createHttpServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += String(chunk);
    requests.push({ url: req.url!, authorization: req.headers.authorization, method: req.method, body });
    res.setHeader('Content-Type', 'application/json'); res.statusCode = req.method === 'POST' ? 201 : 200; res.end(JSON.stringify({ ok: true }));
  });
  let target: string; let http: ViteDevServer; let https: ViteDevServer; let httpUrl: string; let httpsUrl: URL; let cert: Buffer;
  let fixtureFolder: string; let certPath: string; let keyPath: string;
  beforeAll(async () => {
    await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve));
    const address = backend.address(); if (!address || typeof address === 'string') throw Error('QA backend unavailable');
    target = `http://127.0.0.1:${address.port}`;
    const folder = mkdtempSync(join(tmpdir(), 'warehouse-lan-tls-')); fixtureFolder = folder;
    certPath = join(folder, 'qa-cert'); keyPath = join(folder, 'qa-key');
    const openssl = process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl';
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
      '-days', '1', '-subj', '/CN=Warehouse QA', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore', windowsHide: true });
    cert = readFileSync(certPath);
    async function start(mode: string) {
      const options = lanServerOptions(mode, { LAN_TEST_HOST: '127.0.0.1', LAN_TEST_TLS_CERT: certPath, LAN_TEST_TLS_KEY: keyPath }, folder);
      // Only the isolated fixture target differs from the production loopback:3000 target.
      const server = await createViteServer({ configFile: false, root: folder, logLevel: 'silent', server: { ...options, port: 0,
        proxy: { [lanApiPattern]: { target, changeOrigin: true } }, fs: { deny: lanTlsDenyFiles({ LAN_TEST_TLS_CERT: certPath, LAN_TEST_TLS_KEY: keyPath }, folder) } } });
      await server.listen(); return server;
    }
    http = await start('lan'); https = await start('lan-https');
    const httpAddress = http.httpServer!.address(); const httpsAddress = https.httpServer!.address();
    if (!httpAddress || typeof httpAddress === 'string' || !httpsAddress || typeof httpsAddress === 'string') throw Error('QA proxy unavailable');
    httpUrl = `http://127.0.0.1:${httpAddress.port}`; httpsUrl = new URL(`https://127.0.0.1:${httpsAddress.port}/api/auth/me`);
  }, 30000);
  afterAll(async () => {
    await http?.close(); await https?.close(); backend.closeAllConnections();
    await new Promise<void>((resolve, reject) => backend.close(error => error ? reject(error) : resolve()));
  });
  it('forwards /api path/query, JWT, methods and body unchanged and keeps upstream status', async () => {
    const payload = { transaction_id: '10000000-0000-4000-8000-000000000001', movement_type: 'OUT' };
    const response = await fetch(`${httpUrl}/api/stock-movements?qa=1`, { method: 'POST', headers: { Authorization: 'Bearer qa-jwt', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ ok: true });
    expect(requests.at(-1)).toEqual({ url: '/api/stock-movements?qa=1', authorization: 'Bearer qa-jwt', method: 'POST', body: JSON.stringify(payload) });
    const before = requests.length; await fetch(`${httpUrl}/apiary`); expect(requests).toHaveLength(before);
  });
  it('HTTPS proxy succeeds with explicit CA trust and keeps the backend on HTTP loopback', async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpsRequest(httpsUrl, { ca: cert, headers: { Authorization: 'Bearer qa-https-jwt' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }); req.on('error', reject); req.end();
    });
    expect(status).toBe(200); expect(requests.at(-1)?.authorization).toBe('Bearer qa-https-jwt');
  });
  it('untrusted certificates are rejected without disabling TLS validation', async () => {
    await expect(new Promise((resolve, reject) => { const req = httpsRequest(httpsUrl, resolve); req.on('error', reject); req.end(); })).rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  });
  it('certificate/private key files are not served', async () => {
    expect((await fetch(`${httpUrl}/qa-key`)).status).toBe(403);
  });
  it('rejects a certificate without the actual Host-only IP SAN', () => {
    expect(() => lanServerOptions('lan-https', { LAN_TEST_HOST: '192.168.56.1', LAN_TEST_TLS_CERT: certPath, LAN_TEST_TLS_KEY: keyPath }, fixtureFolder)).toThrow('IP SAN');
  });
});
