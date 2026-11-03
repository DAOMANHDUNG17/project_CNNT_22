import { Router } from 'express';
import { createReadRepository } from '../repositories/read.js';
import { listQuery } from '../http/query.js';

export function transactionsRouter(db, schema) {
  const router = Router();
  const repository = createReadRepository(db, schema);
  router.get('/', async (req, res) => res.json(await repository.listTransactions(
    listQuery(req.query, ['productId', 'movementType', 'scanPointId']))));
  return router;
}
