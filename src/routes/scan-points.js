import { Router } from 'express';
import { createReadRepository } from '../repositories/read.js';
import { listQuery } from '../http/query.js';

export function scanPointsRouter(db, schema) {
  const router = Router();
  const repository = createReadRepository(db, schema);
  router.get('/', async (req, res) => res.json(await repository.listScanPoints(listQuery(req.query))));
  return router;
}
