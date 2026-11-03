import { Router } from 'express';
import { HttpError } from '../http/errors.js';
import { createStockWriteRepository } from '../repositories/stock-write.js';

export function stockWriteRouter({ db, schema, csrf }) {
  const router = Router();
  const repository = createStockWriteRepository(db, schema);
  router.post('/transactions', csrf, async (req, res) => {
    const body = req.body;
    const fields = ['transaction_id', 'scan_point_id', 'scan_code', 'movement_type', 'quantity_packages'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(req.query).length
      || Object.keys(body).length !== fields.length || Object.keys(body).some(key => !fields.includes(key))
      || typeof body.transaction_id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.transaction_id)
      || !['IN', 'OUT'].includes(body.movement_type)
      || !Number.isInteger(body.quantity_packages) || body.quantity_packages < 1 || body.quantity_packages > 2147483647
      || [['scan_point_id', 20], ['scan_code', 80]].some(([field, limit]) => typeof body[field] !== 'string'
        || !body[field].trim() || body[field].trim() !== body[field] || [...body[field]].length > limit || body[field].includes('\0'))) {
      throw new HttpError(400, 'INVALID_BODY', 'Invalid transaction payload.');
    }
    const role = req.principal.role;
    if (!['ADMIN', 'KEEPER'].includes(role) && !(role === 'STAFF' && body.movement_type === 'OUT')) {
      throw new HttpError(403, 'FORBIDDEN', 'Movement is not permitted.');
    }
    const result = await repository.record(req.principal.user_id, { ...body, transaction_id: body.transaction_id.toLowerCase() });
    res.status(result.meta.result_status === 'CREATED' ? 201 : 200).json(result);
  });
  return router;
}
