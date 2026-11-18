import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { isLanMode, lanServerOptions, lanTlsDenyFiles } from './config/lan';

// Package the retired API contract as read-only reference material.
function documentationAssets(): Plugin {
  const files = [
    { name: 'swagger/openapi.json', path: new URL('../docs/openapi.json', import.meta.url), type: 'application/json' },
    { name: 'swagger/AN_FRONTEND_HANDOFF.md', path: new URL('../docs/AN_FRONTEND_HANDOFF.md', import.meta.url), type: 'text/plain' },
  ];
  return {
    name: 'warehouse-documentation',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = files.find(item => `/${item.name}` === req.url?.split('?')[0]);
        if (!file) return next();
        res.setHeader('Content-Type', `${file.type}; charset=utf-8`);
        res.end(readFileSync(file.path));
      });
    },
    generateBundle() {
      for (const file of files) this.emitFile({ type: 'asset', fileName: file.name, source: readFileSync(file.path) });
    },
  };
}
export default defineConfig(({ mode, command }) => ({
  plugins: [react(), documentationAssets()],
  ...(isLanMode(mode) ? { define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') } } : {}),
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    ...(isLanMode(mode) && command === 'serve' ? lanServerOptions(mode, loadEnv('lan', fileURLToPath(new URL('.', import.meta.url)), 'LAN_TEST_'), fileURLToPath(new URL('.', import.meta.url))) : {}),
    fs: {
    allow: [
      fileURLToPath(new URL('.',import.meta.url)),
      fileURLToPath(new URL('../docs',import.meta.url)),
      fileURLToPath(new URL('../node_modules',import.meta.url)),
    ],
    deny: ['.env','.env.*','**/*-password.txt','**/tests/**','**/scripts/**','**/test-results/**','**/.certs/**','**/*.pem','**/*.key','**/*.crt','**/*.pfx','**/*.p12',
      ...lanTlsDenyFiles(loadEnv('lan', fileURLToPath(new URL('.', import.meta.url)), 'LAN_TEST_'), fileURLToPath(new URL('.', import.meta.url)))],
  } },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { sourcemap: false, rollupOptions: { input: {
    app: fileURLToPath(new URL('./index.html', import.meta.url)),
    swagger: fileURLToPath(new URL('./swagger/index.html', import.meta.url)),
  } } },
}));
