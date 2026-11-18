import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import type { ServerOptions } from 'vite';

export const lanProxyTarget = 'http://127.0.0.1:3000';
export const lanApiPattern = '^/api(?:/|$)';
export const isLanMode = (mode: string) => mode === 'lan' || mode === 'lan-https';

export function lanTlsDenyFiles(env: Record<string, string | undefined>, root: string): string[] {
  return [env.LAN_TEST_TLS_CERT, env.LAN_TEST_TLS_KEY].filter((file): file is string => !!file)
    .map(file => resolve(root, file).replaceAll('\\', '/'));
}

export function isPrivateIPv4(host: string): boolean {
  if (isIP(host) !== 4) return false;
  const [first, second] = host.split('.').map(Number);
  return first === 10 || first === 192 && second === 168 || first === 172 && second! >= 16 && second! <= 31;
}

export function lanServerOptions(mode: string, env: Record<string, string | undefined>, root: string): ServerOptions {
  const host = env.LAN_TEST_HOST?.trim();
  if (!host || !(isPrivateIPv4(host) || host === '127.0.0.1')) {
    throw new Error('LAN_TEST_HOST must be the Windows Host-only private IPv4 address (not 0.0.0.0 or a public IP). Run npm run lan:help.');
  }
  const options: ServerOptions = {
    host,
    proxy: { [lanApiPattern]: { target: lanProxyTarget, changeOrigin: true } },
  };
  if (mode === 'lan-https') {
    if (!env.LAN_TEST_TLS_CERT || !env.LAN_TEST_TLS_KEY) throw new Error('Set LAN_TEST_TLS_CERT and LAN_TEST_TLS_KEY to a certificate/key trusted by the VMs. Run npm run lan:help.');
    try {
      const cert = readFileSync(resolve(root, env.LAN_TEST_TLS_CERT));
      const key = readFileSync(resolve(root, env.LAN_TEST_TLS_KEY));
      const x509 = new X509Certificate(cert);
      if (!x509.checkIP(host)) throw new Error('Certificate SAN must include LAN_TEST_HOST');
      if (Date.now() < Date.parse(x509.validFrom) || Date.now() >= Date.parse(x509.validTo)) throw new Error('Certificate is not currently valid');
      createSecureContext({ cert, key });
      options.https = { cert, key };
    } catch {
      throw new Error('LAN HTTPS certificate/key cannot be loaded, are expired/mismatched, or do not include LAN_TEST_HOST in the IP SAN.');
    }
  }
  return options;
}
