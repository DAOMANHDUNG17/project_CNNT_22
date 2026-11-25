import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { isLanMode, lanServerOptions, lanTlsDenyFiles } from './config/lan';
import { productionConfig } from './config/production';

const root = fileURLToPath(new URL('.', import.meta.url));

// Serve the retired contract as a read-only reference on development servers.
function documentationAssets(): Plugin {
  const files = [
    {
      name: 'swagger/openapi.json',
      path: new URL('../docs/openapi.json', import.meta.url),
      type: 'application/json',
    },
    {
      name: 'swagger/AN_FRONTEND_HANDOFF.md',
      path: new URL('../docs/AN_FRONTEND_HANDOFF.md', import.meta.url),
      type: 'text/plain',
    },
  ];
  return {
    name: 'warehouse-documentation',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [pathname, query] = req.url?.split('?', 2) ?? [];
        if (pathname === '/swagger')
          req.url = `/swagger/index.html${query ? '?' + query : ''}`;
        const file = files.find((item) => `/${item.name}` === pathname);
        if (!file) return next();
        res.setHeader('Content-Type', `${file.type}; charset=utf-8`);
        res.end(readFileSync(file.path));
      });
    },
  };
}

function swaggerRedirect(apiUrl: string): Plugin {
  const url = apiUrl + '/docs';
  return {
    name: 'warehouse-swagger-redirect',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'swagger/index.html',
        source: `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Tài liệu API Smart Warehouse</title><meta http-equiv="refresh" content="0;url=${url}">
</head><body><a href="${url}">Mở Swagger API</a></body></html>`,
      });
    },
  };
}

export default defineConfig(({ mode, command, isPreview }) => {
  const lan = isLanMode(mode);
  const production =
    command === 'build' && !lan
      ? productionConfig(loadEnv(mode, root, 'VITE_'))
      : undefined;
  const lanEnv = loadEnv('lan', root, 'LAN_TEST_');

  return {
    plugins: [
      react(),
      ...(command === 'serve' && !isPreview ? [documentationAssets()] : []),
      ...(production ? [swaggerRedirect(production.apiUrl)] : []),
    ],
    ...(production
      ? {
          envPrefix: [],
          define: {
            'import.meta.env.VITE_API_URL': JSON.stringify(production.apiUrl),
            'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
              production.supabaseUrl,
            ),
            'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(
              production.supabaseKey,
            ),
          },
        }
      : lan
        ? { define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') } }
        : {}),
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      ...(lan && command === 'serve'
        ? lanServerOptions(mode, lanEnv, root)
        : {}),
      fs: {
        allow: [
          root,
          fileURLToPath(new URL('../docs', import.meta.url)),
          fileURLToPath(new URL('../node_modules', import.meta.url)),
        ],
        deny: [
          '.env',
          '.env.*',
          '**/*-password.txt',
          '**/tests/**',
          '**/scripts/**',
          '**/test-results/**',
          '**/.certs/**',
          '**/*.pem',
          '**/*.key',
          '**/*.crt',
          '**/*.pfx',
          '**/*.p12',
          ...lanTlsDenyFiles(lanEnv, root),
        ],
      },
    },
    preview: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { sourcemap: false },
  };
});
