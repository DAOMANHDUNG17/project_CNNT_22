import { createConnection, createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import type { LogLevel, ViteDevServer } from 'vite';
import { lanApiPattern, lanProxyTarget } from './lan.ts';

export const hostOnlyAddresses = ['192.168.10.1', '192.168.20.1'] as const;
const frontendRoot = fileURLToPath(new URL('../', import.meta.url));

export function availableDevHosts() {
  const addresses = new Set(Object.values(networkInterfaces()).flatMap(entries => entries?.map(entry => entry.address) ?? []));
  return ['127.0.0.1', ...(addresses.has('::1') ? ['::1'] : []), ...hostOnlyAddresses.filter(host => addresses.has(host))];
}

export function devUrl(host: string, port: number) {
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}/`;
}

interface DevOptions {
  port?: number;
  hosts?: string[];
  apiTarget?: string;
  cacheDir?: string;
  logLevel?: LogLevel;
}

// Share one Vite instance, including HMR WebSockets, across explicit interfaces.
export async function startDev(options: DevOptions = {}) {
  const hosts = [...new Set(['127.0.0.1', ...(options.hosts ?? availableDevHosts())])];
  const forwards: Server[] = [];
  const sockets = new Set<Socket>();
  let vite: ViteDevServer | undefined;
  let closing: Promise<void> | undefined;

  function close() {
    return closing ??= (async () => {
      for (const socket of sockets) socket.destroy();
      await Promise.all(forwards.map(server => new Promise<void>(resolveClose => {
        if (!server.listening) return resolveClose();
        server.close(() => resolveClose());
      })));
      await vite?.close();
    })();
  }

  try {
    vite = await createViteServer({
      root: frontendRoot,
      configFile: resolve(frontendRoot, 'vite.config.ts'),
      mode: 'development',
      clearScreen: false,
      ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
      ...(options.logLevel ? { logLevel: options.logLevel } : {}),
      define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
      server: {
        host: '127.0.0.1', port: options.port ?? 5173, strictPort: true,
        proxy: { [lanApiPattern]: { target: options.apiTarget ?? lanProxyTarget, changeOrigin: true } },
      },
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Vite did not open a TCP listener.');
    const port = address.port;

    for (const host of hosts.filter(host => host !== '127.0.0.1')) {
      const forward = createServer(client => {
        const upstream = createConnection({ host: '127.0.0.1', port });
        sockets.add(client); sockets.add(upstream);
        client.on('error', () => upstream.destroy());
        upstream.on('error', () => client.destroy());
        client.on('close', () => { sockets.delete(client); upstream.destroy(); });
        upstream.on('close', () => { sockets.delete(upstream); client.destroy(); });
        client.pipe(upstream).pipe(client);
      });
      forwards.push(forward);
      await new Promise<void>((resolveListen, reject) => {
        forward.once('error', reject);
        forward.listen({ host, port, ipv6Only: host === '::1' }, () => {
          forward.off('error', reject);
          resolveListen();
        });
      }).catch((cause: NodeJS.ErrnoException) => {
        throw new Error(`Cannot open ${devUrl(host, port)} (${cause.code}). Stop the old frontend on this address, then run npm run dev again.`, { cause });
      });
    }
    return { port, hosts, vite, close };
  } catch (error) {
    await close();
    throw error;
  }
}
