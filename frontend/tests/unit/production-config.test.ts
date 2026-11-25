import { afterEach, describe, expect, it, vi } from 'vitest';
import vercel from '../../../vercel.json';
import { productionConfig } from '../../config/production';
import viteConfig from '../../vite.config';

const apiOrigin = 'https://api.example.test';
const supabaseUrl = 'https://project.example.test';
const publishableKey = 'sb_publishable_fixture';
const env = {
  VITE_API_URL: apiOrigin,
  VITE_SUPABASE_URL: supabaseUrl,
  VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
};

function legacyKey(role: string) {
  return [
    Buffer.from('{"alg":"HS256"}').toString('base64url'),
    Buffer.from(JSON.stringify({ role })).toString('base64url'),
    'fixture',
  ].join('.');
}

afterEach(() => vi.unstubAllEnvs());

describe('production environment', () => {
  it.each(['', '/', '/api', '/api/'])(
    'normalizes the API suffix %j once',
    (suffix) => {
      expect(
        productionConfig({ ...env, VITE_API_URL: apiOrigin + suffix }).apiUrl,
      ).toBe(apiOrigin + '/api');
    },
  );

  it.each([
    undefined,
    '/api',
    'http://api.example.test',
    'https://localhost:3000/api',
    'https://127.0.0.1/api',
    'https://192.168.10.1/api',
    apiOrigin + '/api/api',
    apiOrigin + '/api?query',
    apiOrigin + '/api#fragment',
    'https://account@api.example.test',
  ])('rejects invalid production API configuration (case %#)', (value) => {
    expect(() => productionConfig({ ...env, VITE_API_URL: value })).toThrow(
      'VITE_API_URL',
    );
  });

  it('requires a Supabase project HTTPS origin', () => {
    expect(() =>
      productionConfig({ ...env, VITE_SUPABASE_URL: undefined }),
    ).toThrow('VITE_SUPABASE_URL');
    expect(() =>
      productionConfig({ ...env, VITE_SUPABASE_URL: supabaseUrl + '/auth/v1' }),
    ).toThrow('VITE_SUPABASE_URL');
  });

  it('supports legacy anon when a publishable key was omitted', () => {
    const anon = legacyKey('anon');
    expect(
      productionConfig({
        ...env,
        VITE_SUPABASE_PUBLISHABLE_KEY: '',
        VITE_SUPABASE_ANON_KEY: anon,
      }).supabaseKey,
    ).toBe(anon);
  });

  it.each(['', 'sb_secret_fixture', legacyKey('service_role')])(
    'rejects absent or privileged browser keys (case %#)',
    (key) => {
      expect(() =>
        productionConfig({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: key }),
      ).toThrow('must be a Supabase public key');
    },
  );

  it('allowlists only public build definitions and keeps historical docs in development', async () => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    vi.stubEnv('VITE_SUPABASE_SERVICE_ROLE_KEY', 'isolated-fixture');
    const production = await viteConfig({
      command: 'build',
      mode: 'production',
    });
    const development = await viteConfig({
      command: 'serve',
      mode: 'development',
    });
    const preview = await viteConfig({
      command: 'serve',
      mode: 'production',
      isPreview: true,
    });

    expect(production.envPrefix).toEqual([]);
    expect(production.define).toEqual({
      'import.meta.env.VITE_API_URL': JSON.stringify(apiOrigin + '/api'),
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':
        JSON.stringify(publishableKey),
    });
    expect(production.plugins).toContainEqual(
      expect.objectContaining({ name: 'warehouse-swagger-redirect' }),
    );
    expect(production.plugins).not.toContainEqual(
      expect.objectContaining({ name: 'warehouse-documentation' }),
    );
    expect(development.plugins).toContainEqual(
      expect.objectContaining({ name: 'warehouse-documentation' }),
    );
    expect(preview.plugins).not.toContainEqual(
      expect.objectContaining({ name: 'warehouse-documentation' }),
    );
  });
});

describe('Vercel SPA routes', () => {
  function destination(path: string) {
    return vercel.rewrites.find(({ source }) =>
      new RegExp('^' + source + '$').test(path),
    )?.destination;
  }

  it('rewrites application deep links and routes the Swagger entry independently', () => {
    for (const path of [
      '/',
      '/login',
      '/products',
      '/inventory',
      '/transactions',
      '/scan-points',
      '/stock-movement',
      '/users',
      '/settings',
      '/403',
      '/unknown/route',
    ]) {
      expect(destination(path)).toBe('/index.html');
    }
    expect(destination('/swagger')).toBe('/swagger/index.html');
    expect(destination('/swagger/')).toBe('/swagger/index.html');
  });

  it('keeps file requests, legacy docs and API requests out of the SPA fallback', () => {
    for (const path of [
      '/assets/app.js',
      '/favicon.svg',
      '/licenses/font.txt',
      '/swagger/index.html',
      '/swagger/openapi.json',
      '/swagger/AN_FRONTEND_HANDOFF.md',
      '/api/health',
    ]) {
      expect(destination(path)).toBeUndefined();
    }
  });
});
