import pg from 'pg';
import { HttpError } from '../http/errors.js';

const fields = {
  product: ['product_id', 'product_name', 'base_unit', 'is_active', 'created_at'],
  unit: ['product_unit_id', 'product_id', 'unit_name', 'conversion_factor', 'scan_code', 'is_base_unit'],
  'scan-point': ['scan_point_id', 'point_name', 'is_active'],
  user: ['user_id', 'username', 'display_name', 'role', 'is_active', 'created_at'],
};
const actions = new Set(['product.create', 'product.update', 'product.status', 'unit.create', 'unit.update',
  'scan-point.create', 'scan-point.update', 'user.create', 'user.update', 'user.status', 'user.reset-password']);
const domainErrors = {
  PZA01: [400, 'INVALID_BODY', 'Invalid administrative request.'],
  PZA02: [404, 'RESOURCE_NOT_FOUND', 'Resource not found.'],
  PZA03: [409, 'RESOURCE_CONFLICT', 'A resource with this identifier already exists.'],
  PZA04: [403, 'FORBIDDEN', 'Administrative access is required.'],
  PZA05: [409, 'LAST_ADMIN_REQUIRED', 'The last active administrator must remain active.'],
  PZA06: [409, 'UNSAFE_UNIT_CHANGE', 'This unit definition is in use. Create a new unit and scan code.'],
};

export function createAdminWriteRepository(db, schema = 'public') {
  const fn = `${pg.escapeIdentifier(schema)}.admin_dashboard_write`;
  return {
    async execute(actorId, action, payload) {
      if (!actions.has(action)) throw new Error('Unsupported admin repository action.');
      if (typeof actorId !== 'string' || !/^[1-9]\d{0,18}$/.test(actorId) || BigInt(actorId) > 9223372036854775807n) {
        throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
      }
      let result;
      try {
        // One statement is an atomic database transaction. No client actor/role is used.
        result = await db.query(`SELECT ${fn}($1::bigint,$2::text,$3::jsonb) AS data`,
          [actorId, action, JSON.stringify(payload)]);
      } catch (error) {
        const domain = domainErrors[error.code];
        if (domain) throw new HttpError(...domain);
        throw error;
      }
      const row = result.rows[0]?.data;
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid administrative result.');
      const data = Object.fromEntries(fields[action.split('.')[0]].map(key => [key, row[key]]));
      if (data.created_at != null) data.created_at = new Date(data.created_at).toISOString();
      return { data };
    },
  };
}
