import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import viteConfig from '../../vite.config';
import { isPrivateIPv4, lanApiPattern, lanProxyTarget, lanServerOptions, lanTlsDenyFiles } from '../../config/lan';

const root = fileURLToPath(new URL('../../', import.meta.url));
afterEach(() => vi.unstubAllEnvs());
describe('isolated Host-only LAN configuration', () => {
  it('preserves localhost dev and preview without a proxy override', async () => {
    const config = await viteConfig({ mode: 'development', command: 'serve' });
    expect(config.server?.host).toBe('127.0.0.1'); expect(config.server?.port).toBe(5173);
    expect(config.server?.proxy).toBeUndefined(); expect(config.define).toBeUndefined(); expect(config.preview?.host).toBe('127.0.0.1');
  });
  it('LAN mode binds the explicit private interface and forces relative API despite old localhost env', async () => {
    vi.stubEnv('LAN_TEST_HOST', '192.168.56.1'); vi.stubEnv('VITE_API_URL', 'http://localhost:3000/api');
    const config = await viteConfig({ mode: 'lan', command: 'serve' });
    expect(config.server?.host).toBe('192.168.56.1'); expect(config.define?.['import.meta.env.VITE_API_URL']).toBe(JSON.stringify('/api'));
    expect(config.server?.proxy?.[lanApiPattern]).toEqual({ target: 'http://127.0.0.1:3000', changeOrigin: true });
    expect(config.server?.allowedHosts).not.toBe(true);
  });
  it('LAN build uses /api without requiring a VM interface or certificate', async () => {
    const config = await viteConfig({ mode: 'lan-https', command: 'build' });
    expect(config.define?.['import.meta.env.VITE_API_URL']).toBe(JSON.stringify('/api')); expect(config.server?.https).toBeUndefined();
  });
  it.each(['', '0.0.0.0', '8.8.8.8', '::', 'localhost', '192.168.56.1;command'])('refuses unsafe/unspecified binding %s', host => {
    expect(() => lanServerOptions('lan', { LAN_TEST_HOST: host }, root)).toThrow('LAN_TEST_HOST');
  });
  it('requires valid certificate/key for HTTPS without silently downgrading', () => {
    expect(() => lanServerOptions('lan-https', { LAN_TEST_HOST: '192.168.56.1' }, root)).toThrow('LAN_TEST_TLS_CERT');
    expect(() => lanServerOptions('lan-https', { LAN_TEST_HOST: '192.168.56.1', LAN_TEST_TLS_CERT: 'missing.crt', LAN_TEST_TLS_KEY: 'missing.key' }, root)).toThrow('cannot be loaded');
  });
  it('protects env and certificate files in both localhost and LAN modes', async () => {
    const config = await viteConfig({ mode: 'development', command: 'serve' });
    expect(config.server?.fs?.deny).toEqual(expect.arrayContaining(['.env', '.env.*', '**/*.pem', '**/*.key', '**/.certs/**']));
  });
  it('proxies only /api routes without stripping their prefix or changing auth headers', () => {
    const matcher = new RegExp(lanApiPattern);
    expect(['/api', '/api/users/2/scan-points', '/api/stock-movements', '/api/transactions?page=2'].every(path => matcher.test(path))).toBe(true);
    expect(matcher.test('/apiary')).toBe(false); expect(lanProxyTarget).toBe('http://127.0.0.1:3000');
    expect(isPrivateIPv4('172.16.1.1')).toBe(true); expect(isPrivateIPv4('172.32.1.1')).toBe(false);
  });
  it('denies configured certificate/key paths even when they have no extension', () => {
    const files = lanTlsDenyFiles({ LAN_TEST_TLS_CERT: 'local-cert', LAN_TEST_TLS_KEY: 'local-key' }, root);
    expect(files).toHaveLength(2); expect(files.every(file => file.includes('/') && !file.includes('\\'))).toBe(true);
    expect(files[1]).toMatch(/\/local-key$/);
  });
});
