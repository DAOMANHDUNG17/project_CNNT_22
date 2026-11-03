import { Router } from 'express';
import { createReadRepository } from '../repositories/read.js';
import { listQuery, text, validateKeys } from '../http/query.js';

export function productsRouter(db, schema) {
  const router = Router();
  const repository = createReadRepository(db, schema);
  router.get('/', async (req, res) => {
    res.json(await repository.listProducts(listQuery(req.query, ['q'])));
  });
  router.get('/:id', async (req, res) => {
    validateKeys(req.query);
    res.json(await repository.getProduct(text(req.params.id, 'id', 20)));
  });
  return router;
}
