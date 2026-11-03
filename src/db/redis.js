import { createClient } from 'redis';
import { logError } from '../middleware/error-handler.js';

export function createSessionRedis(config, logger = console) {
  const client = createClient({
    socket: { host: config.host, port: config.port, connectTimeout: 3000,
      reconnectStrategy: retries => Math.min(100 + retries * 100, 3000) },
    username: config.username, password: config.password,
    maintNotifications: 'disabled', disableOfflineQueue: true, commandsQueueMaxLength: 100,
    commandOptions: { timeout: 3000 },
  });
  client.on('error', error => logError(logger, 'session_store_error', error));
  return client;
}
