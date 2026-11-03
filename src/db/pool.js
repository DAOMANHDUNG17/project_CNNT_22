import pg from 'pg';
import { logError } from '../middleware/error-handler.js';

export function createPool(config, logger = console) {
  const pool = new pg.Pool(config);
  // An idle connection can emit an error outside a request (e.g. DB restart).
  pool.on('error', (error) => logError(logger, 'database_idle_error', error));
  return pool;
}
