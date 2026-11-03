import { Router } from 'express';
import { logError } from '../middleware/error-handler.js';

export function healthRouter(db, logger) {
  const router = Router();
  router.get('/', async (req, res) => {
    try {
      // Every request reaches PostgreSQL. This is not a cached process-only check.
      await db.query('SELECT 1 AS connected');
      res.json({ status: 'ok', database: 'connected' });
    } catch (error) {
      logError(logger, 'health_database_error', error);
      res.status(503).json({ status: 'error', database: 'disconnected' });
    }
  });
  return router;
}
