import pg from 'pg';
import { HttpError } from '../http/errors.js';

const errors = {
  PZ001: [400, 'INVALID_BODY'], PZ002: [401, 'AUTHENTICATION_REQUIRED'], PZ003: [403, 'FORBIDDEN'],
  PZ004: [409, 'IDEMPOTENCY_CONFLICT'], PZ005: [409, 'IDEMPOTENCY_LEGACY_RECORD'],
  PZ006: [422, 'INVALID_SCAN_POINT'], PZ007: [422, 'INVALID_SCAN_CODE'], PZ008: [422, 'PRODUCT_INACTIVE'],
  PZ009: [500, 'INVENTORY_STATE_INVALID'], PZ010: [409, 'INSUFFICIENT_INVENTORY'], PZ011: [409, 'STOCK_LIMIT_EXCEEDED'],
};
export function createStockWriteRepository(db, schema = 'public') {
  const prefix = pg.escapeIdentifier(schema);
  return {
    async record(actorId, input) {
      const deadline = Date.now() + 10_000;
      for (let attempt = 0; ; attempt++) {
        let client;
        let committing = false;
        let discard = false;
        try {
          client = await db.connect();
          await client.query('BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE');
          await client.query("SET LOCAL lock_timeout='1s'");
          await client.query("SET LOCAL statement_timeout='5s'");
          const result = (await client.query(`SELECT result_status,current_inventory FROM ${prefix}.record_stock_movement(
            $1::uuid,$2::bigint,$3::varchar,$4::varchar,$5::varchar,$6::integer)`,
          [input.transaction_id, actorId, input.scan_point_id, input.scan_code, input.movement_type, input.quantity_packages])).rows[0];
          if (!result || !['CREATED', 'DUPLICATE'].includes(result.result_status)) throw new Error('Invalid movement result.');
          const data = (await client.query(`SELECT transaction_id,product_id,product_unit_id,scan_point_id,movement_type,
            quantity_packages,conversion_factor_snapshot,quantity_base,inventory_after,created_at
            FROM ${prefix}.stock_transactions WHERE transaction_id=$1::uuid`, [input.transaction_id])).rows[0];
          if (!data) throw new Error('Committed movement record is missing.');
          committing = true;
          await client.query('COMMIT');
          return { data, meta: { result_status: result.result_status } };
        } catch (error) {
          discard = committing || error.code?.startsWith('08') || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(error.code);
          if (client && !committing) { try { await client.query('ROLLBACK'); } catch { discard = true; } }
          if (committing && !['40001', '40P01'].includes(error.code)) {
            const uncertain = new HttpError(503, 'TRANSACTION_OUTCOME_UNKNOWN', 'Retry the same transaction_id and payload to determine the result.');
            uncertain.transaction_id = input.transaction_id;
            throw uncertain;
          }
          if (['40001', '40P01'].includes(error.code) && attempt < 2 && Date.now() + 250 < deadline) {
            await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt + Math.floor(Math.random() * 25)));
            continue;
          }
          if (errors[error.code]) {
            const [status, code] = errors[error.code];
            throw new HttpError(status, code, code.replaceAll('_', ' ').toLowerCase() + '.');
          }
          if (['55P03', '57014', '40001', '40P01'].includes(error.code)) {
            throw new HttpError(503, 'STOCK_BUSY', 'Stock is busy; retry the same transaction_id.');
          }
          throw error;
        } finally { if (client) client.release(discard); }
      }
    },
  };
}
