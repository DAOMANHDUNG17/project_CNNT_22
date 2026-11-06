import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { loadCloudEnvironment } from '../../scripts/lib/cloud-environment.js';
import { readCloudConfig } from '../config/cloud.js';
import { assertCloudReleaseReady } from './release-gate.js';
import { createPool } from '../db/pool.js';
import { checkCloudAccess } from '../db/cloud-access.js';
import { createCloudApplication } from './application.js';
import { closeResources } from '../lifecycle.js';
import { logError } from '../middleware/error-handler.js';

let reader, writer, server;
try {
  const config = readCloudConfig(loadCloudEnvironment());
  assertCloudReleaseReady(); // Before pg Pool creation, JWKS/Auth calls or HTTP listen.
  reader = createPool(config.database);
  writer = createPool(config.writer);
  await checkCloudAccess(reader, writer);
  const authClient = createClient(config.auth.url, config.auth.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(config.auth.timeoutMs) }) },
  });
  server = http.createServer(createCloudApplication({ config, reader, writer, authClient }));
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  let stopping = false;
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true; process.exitCode = code;
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000);
    try { await closeResources(server, { end: () => Promise.all([reader.end(), writer.end()]) }); }
    finally { clearTimeout(deadline); }
  }
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
  process.on('message', message => { if (message === 'shutdown') void stop(); });
  process.once('disconnect', () => void stop());
  server.on('error', error => { logError(console, 'cloud_http_error', error); void stop(1); });
  server.listen(config.port, config.host, () => {
    console.info(`Cloud API listening on loopback port ${config.port}.`);
    process.send?.({ type: 'ready' });
  });
} catch (error) {
  // Config errors identify a field, never echo its value or driver connection detail.
  if (error.code === 'CLOUD_RELEASE_BLOCKED' || !reader) console.error(error.message);
  else logError(console, 'cloud_startup_failed', error);
  await Promise.allSettled([reader?.end(), writer?.end()]);
  process.exitCode = 1;
}
