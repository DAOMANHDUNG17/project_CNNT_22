import http from 'node:http';
import { readSecureConfig } from './config/secure.js';
import { createPool } from './db/pool.js';
import { createApp } from './app.js';
import { closeResources } from './lifecycle.js';
import { logError } from './middleware/error-handler.js';
import { createSessionRedis } from './db/redis.js';
import { checkSecureAccess } from './db/secure-access.js';
import { createAuth } from './auth/index.js';

let config;
try {
  config = readSecureConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const pool = createPool(config.database);
const writer = createPool(config.writer);
const redis = createSessionRedis(config.redis);
let connectDeadline;
try {
  await checkSecureAccess(pool, writer);
  await Promise.race([redis.connect(), new Promise((_, reject) => {
    connectDeadline = setTimeout(() => reject(new Error('Session store connection timed out.')), 6000);
  })]);
  await redis.ping();
} catch (error) {
  logError(console, 'startup_preflight_failed', error);
  if (redis.isOpen) redis.destroy();
  await Promise.allSettled([pool.end(), writer.end()]);
  process.exitCode = 1;
  process.exit(1);
} finally { clearTimeout(connectDeadline); }
const auth = createAuth({ db: writer, redis, schema: config.schema, config: config.auth });
const server = http.createServer(createApp({ db: pool, writerDb: writer, auth, schema: config.schema }));
server.requestTimeout = 15000;
server.headersTimeout = 10000;

let stopping = false;
async function shutdown(reason, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  console.info(`Stopping server: ${reason}`);
  const deadline = setTimeout(() => {
    console.error('Graceful shutdown timed out.');
    server.closeAllConnections();
    process.exit(1);
  }, 10000);
  try {
    await closeResources(server, { async end() {
      if (redis.isReady) await redis.close(); else if (redis.isOpen) redis.destroy();
      await Promise.all([pool.end(), writer.end()]);
    } });
    console.info('HTTP server and PostgreSQL pool closed.');
  } catch (error) {
    logError(console, 'shutdown_error', error);
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
server.on('error', (error) => {
  logError(console, 'http_server_error', error);
  void shutdown('HTTP server error', 1);
});
server.listen(config.port, config.host, () => {
  console.info(`API listening at http://${config.host}:${config.port}`);
  console.info('Use GET /api/health to verify the database connection.');
});
