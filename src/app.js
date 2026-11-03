import express from 'express';
import { healthRouter } from './routes/health.js';
import { productsRouter } from './routes/products.js';
import { errorHandler } from './middleware/error-handler.js';
import { inventoryRouter } from './routes/inventory.js';
import { transactionsRouter } from './routes/transactions.js';
import { scanPointsRouter } from './routes/scan-points.js';
import { dashboardReadRouter } from './routes/dashboard-read.js';
import { adminWriteRouter } from './routes/admin-write.js';
import { stockWriteRouter } from './routes/stock-write.js';
import { HttpError } from './http/errors.js';

export function createApp({ db, writerDb, auth, schema = 'public', logger = console }) {
  if (!auth || !writerDb) throw new Error('Secure application requires authentication and a dedicated writer pool.');
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/health', healthRouter(db, logger));
  app.use('/api', (req, res, next) => {
    if (['POST', 'PATCH'].includes(req.method) && req.path !== '/auth/logout' && !req.is('application/json')) {
      return next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.'));
    }
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use('/api/auth', auth.router);
  app.use('/api', auth.authenticate);
  app.use('/api', dashboardReadRouter({ db, userDb: writerDb, schema, requireAdmin: auth.requireRoles('ADMIN') }));
  app.use('/api', stockWriteRouter({ db: writerDb, schema, csrf: auth.csrf }));
  app.use('/api', adminWriteRouter({ db: writerDb, schema, hashPassword: auth.hashPassword,
    revokeUserSessions: auth.revokeUserSessions, csrf: auth.csrf, requireAdmin: auth.requireRoles('ADMIN') }));
  app.use('/api/products', productsRouter(db, schema));
  app.use('/api/inventory', inventoryRouter(db, schema));
  app.use('/api/transactions', transactionsRouter(db, schema));
  app.use('/api/scan-points', scanPointsRouter(db, schema));
  app.use((req, res) => res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Route not found.' },
  }));
  app.use(errorHandler(logger));
  return app;
}
