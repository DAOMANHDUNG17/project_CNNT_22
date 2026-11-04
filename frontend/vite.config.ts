import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Keep the original browser Origin: the backend checks it for login/CSRF.
const proxy = { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } };
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy, fs: {
    allow: [fileURLToPath(new URL('.',import.meta.url)), fileURLToPath(new URL('../docs',import.meta.url))],
    deny: ['.env','.env.*','**/*-password.txt','**/tests/**','**/scripts/**','**/test-results/**'],
  } },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  build: { sourcemap: false },
});
