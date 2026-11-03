// Isolated legacy read regression factory. Runtime server uses authenticated createApp.
import express from 'express';
import { healthRouter } from './routes/health.js';
import { productsRouter } from './routes/products.js';
import { errorHandler } from './middleware/error-handler.js';
import { inventoryRouter } from './routes/inventory.js';
import { transactionsRouter } from './routes/transactions.js';
import { scanPointsRouter } from './routes/scan-points.js';

export function createReadOnlyApp({ db, schema = 'public', logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/health', healthRouter(db, logger));
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
