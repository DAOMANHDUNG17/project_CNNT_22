import { Router } from 'express';
import { createReadRepository } from '../repositories/read.js';
import { listQuery, text, validateKeys } from '../http/query.js';

export function inventoryRouter(db, schema) {
  const router = Router();
  const repository = createReadRepository(db, schema);
  router.get('/', async (req, res) => res.json(await repository.listInventory(listQuery(req.query))));
  router.get('/:productId', async (req, res) => {
    validateKeys(req.query);
    res.json(await repository.getInventory(text(req.params.productId, 'productId', 20)));
  });
  return router;
}
