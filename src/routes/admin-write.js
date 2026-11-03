import { Router } from 'express';
import { HttpError } from '../http/errors.js';
import { createAdminWriteRepository } from '../repositories/admin-write.js';

const invalid = () => new HttpError(400, 'INVALID_BODY', 'Request body or identifier is invalid.');
const roles = ['ADMIN', 'KEEPER', 'STAFF', 'VIEWER'];

function body(value, allowed, required = [], minimum = 1) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length < minimum || Object.keys(value).some(key => !allowed.includes(key))
      || required.some(key => !Object.hasOwn(value, key))) throw invalid();
  return { ...value };
}
function text(value, max) {
  if (typeof value !== 'string' || !value || value !== value.trim() || [...value].length > max || value.includes('\0')) throw invalid();
  return value;
}
function id(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) throw invalid();
  return value;
}
function validate(value) {
  const limits = { product_id: 20, product_name: 150, base_unit: 30, unit_name: 30, scan_code: 80,
    scan_point_id: 20, point_name: 100, username: 50, display_name: 120 };
  for (const [key, entry] of Object.entries(value)) {
    if (Object.hasOwn(limits, key)) text(entry, limits[key]);
    else if (['is_active', 'is_base_unit'].includes(key) && typeof entry !== 'boolean') throw invalid();
    else if (key === 'conversion_factor' && (!Number.isInteger(entry) || entry < 1 || entry > 2147483647)) throw invalid();
    else if (key === 'role' && !roles.includes(entry)) throw invalid();
    else if (key === 'password' && (typeof entry !== 'string' || !entry || entry.includes('\0'))) throw invalid();
  }
  return value;
}

export function adminWriteRouter({ db, schema = 'public', repository = createAdminWriteRepository(db, schema),
  hashPassword, revokeUserSessions, requireAdmin, csrf } = {}) {
  const router = Router();
  // Defense in depth: root also authenticates and authorizes this router.
  const principalGuard = (req, res, next) => {
    if (!req.principal) return next(new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.'));
    if (req.principal.role !== 'ADMIN' || !req.principal.is_active) return next(new HttpError(403, 'FORBIDDEN', 'Administrative access is required.'));
    next();
  };
  const queryGuard = (req, res, next) => {
    if (Object.keys(req.query).length) return next(new HttpError(400, 'INVALID_QUERY', 'Query parameters are not supported for this operation.'));
    next();
  };
  const add = (method, path, handler) => router[method](path,
    ...[principalGuard, requireAdmin, csrf, queryGuard].filter(Boolean), handler);
  const write = (action, status, payload) => async (req, res) => {
    const validated = validate(payload(req));
    if (Object.hasOwn(validated, 'password')) {
      if (typeof hashPassword !== 'function') throw new Error('Password service is unavailable.');
      validated.password_hash = await hashPassword(validated.password);
      delete validated.password;
    }
    const result = await repository.execute(req.principal.user_id, action, validated);
    if (['user.update', 'user.status', 'user.reset-password'].includes(action) && revokeUserSessions) {
      // SQL auth_version is authoritative if Redis is unavailable after commit.
      // Revocation cleanup errors must not turn an already committed admin write into a retryable failure.
      try { await revokeUserSessions(result.data.user_id); } catch { /* version checked per authenticated request */ }
    }
    res.status(status).json(result);
  };

  add('post', '/products', write('product.create', 201, req => body(req.body,
    ['product_id', 'product_name', 'base_unit', 'is_active'], ['product_id', 'product_name', 'base_unit'])));
  add('patch', '/products/:id', write('product.update', 200, req => ({ ...body(req.body,
    ['product_name', 'base_unit']), product_id: text(req.params.id, 20) })));
  add('patch', '/products/:id/status', write('product.status', 200, req => ({ ...body(req.body,
    ['is_active'], ['is_active']), product_id: text(req.params.id, 20) })));
  add('post', '/products/:id/units', write('unit.create', 201, req => ({ ...body(req.body,
    ['unit_name', 'conversion_factor', 'scan_code', 'is_base_unit'], ['unit_name', 'conversion_factor', 'scan_code']),
  product_id: text(req.params.id, 20) })));
  add('patch', '/product-units/:id', write('unit.update', 200, req => ({ ...body(req.body,
    ['unit_name', 'conversion_factor', 'is_base_unit']), product_unit_id: id(req.params.id) })));
  add('post', '/scan-points', write('scan-point.create', 201, req => body(req.body,
    ['scan_point_id', 'point_name', 'is_active'], ['scan_point_id', 'point_name'])));
  add('patch', '/scan-points/:id', write('scan-point.update', 200, req => ({ ...body(req.body,
    ['point_name', 'is_active']), scan_point_id: text(req.params.id, 20) })));
  add('post', '/users', write('user.create', 201, req => body(req.body,
    ['username', 'display_name', 'role', 'password', 'is_active'], ['username', 'display_name', 'role', 'password'])));
  add('patch', '/users/:id', write('user.update', 200, req => ({ ...body(req.body,
    ['username', 'display_name', 'role']), user_id: id(req.params.id) })));
  add('patch', '/users/:id/status', write('user.status', 200, req => ({ ...body(req.body,
    ['is_active'], ['is_active']), user_id: id(req.params.id) })));
  add('post', '/users/:id/reset-password', write('user.reset-password', 200, req => ({ ...body(req.body,
    ['password'], ['password']), user_id: id(req.params.id) })));
  return router;
}
