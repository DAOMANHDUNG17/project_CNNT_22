import { Router } from 'express';
import { HttpError } from '../http/errors.js';
import { listQuery, text, validateKeys } from '../http/query.js';
import { createDashboardReadRepository } from '../repositories/dashboard-read.js';

const invalid = message => new HttpError(400, 'INVALID_QUERY', message);
const roles = ['ADMIN', 'KEEPER', 'STAFF', 'VIEWER'];
const dayMillis = 86400000;

function pagination(query) {
  return listQuery(Object.fromEntries(['page', 'limit'].filter(name => query[name] !== undefined).map(name => [name, query[name]])));
}

function threshold(value = '10') {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw invalid('threshold must be a non-negative bigint string.');
  }
  return value;
}

function date(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) throw invalid(`${name} must be a valid YYYY-MM-DD UTC date.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw invalid(`${name} must be a valid YYYY-MM-DD UTC date.`);
  return parsed;
}

function range(query) {
  const today = new Date().toISOString().slice(0, 10);
  const toDate = date(query.to ?? today, 'to');
  const fromDate = query.from === undefined ? new Date(toDate.valueOf() - 29 * dayMillis) : date(query.from, 'from');
  if (fromDate.getUTCFullYear() < 1) throw invalid('Date range must begin in year 0001 or later.');
  const days = (toDate.valueOf() - fromDate.valueOf()) / dayMillis + 1;
  if (days < 1 || days > 366) throw invalid('Date range must be ordered and contain no more than 366 inclusive UTC days.');
  const result = { from: fromDate.toISOString().slice(0, 10), to: toDate.toISOString().slice(0, 10) };
  for (const name of ['productId', 'scanPointId']) if (query[name] !== undefined) result[name] = text(query[name], name, 20);
  if (query.movementType !== undefined) {
    if (!['IN', 'OUT'].includes(query.movementType)) throw invalid('movementType must be IN or OUT.');
    result.movementType = query.movementType;
  }
  return result;
}

export const dashboardReadQueries = {
  lowStock(query) {
    validateKeys(query, ['page', 'limit', 'threshold', 'q']);
    return { ...pagination(query), threshold: threshold(query.threshold), ...(query.q === undefined ? {} : { q: text(query.q, 'q', 150) }) };
  },
  users(query) {
    validateKeys(query, ['page', 'limit', 'q', 'role', 'isActive']);
    const result = pagination(query);
    if (query.q !== undefined) result.q = text(query.q, 'q', 150);
    if (query.role !== undefined) {
      if (!roles.includes(query.role)) throw invalid('role must be ADMIN, KEEPER, STAFF or VIEWER.');
      result.role = query.role;
    }
    if (query.isActive !== undefined) {
      if (!['true', 'false'].includes(query.isActive)) throw invalid('isActive must be true or false.');
      result.isActive = query.isActive === 'true';
    }
    return result;
  },
  summary(query) {
    validateKeys(query, ['threshold']);
    return { threshold: threshold(query.threshold) };
  },
  trends(query) {
    validateKeys(query, ['page', 'limit', 'from', 'to', 'granularity', 'productId', 'movementType', 'scanPointId']);
    const granularity = query.granularity ?? 'day';
    if (!['day', 'month'].includes(granularity)) throw invalid('granularity must be day or month.');
    return { ...pagination(query), ...range(query), granularity };
  },
  topProducts(query) {
    validateKeys(query, ['page', 'limit', 'from', 'to', 'productId', 'movementType', 'scanPointId', 'q', 'baseUnit', 'sortBy']);
    const sortBy = query.sortBy ?? 'transactions';
    if (!['transactions', 'inQuantity', 'outQuantity'].includes(sortBy)) throw invalid('sortBy must be transactions, inQuantity or outQuantity.');
    if (sortBy !== 'transactions' && query.baseUnit === undefined) throw invalid('baseUnit is required when ranking quantities.');
    return { ...pagination(query), ...range(query), sortBy,
      ...(query.q === undefined ? {} : { q: text(query.q, 'q', 150) }),
      ...(query.baseUnit === undefined ? {} : { baseUnit: text(query.baseUnit, 'baseUnit', 30) }) };
  },
};

export function dashboardReadRouter({ db, userDb = db, schema = 'public', requireAdmin }) {
  const router = Router();
  const repository = createDashboardReadRepository(db, schema);
  const userRepository = createDashboardReadRepository(userDb, schema);
  const admin = requireAdmin ?? ((req, res, next) => next(new HttpError(403, 'FORBIDDEN', 'Permission denied.')));
  router.get('/inventory/low-stock', async (req, res) => res.json(await repository.listLowStock(dashboardReadQueries.lowStock(req.query))));
  router.get('/transactions/:id', async (req, res) => {
    validateKeys(req.query);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
      throw new HttpError(400, 'INVALID_PARAMETER', 'Transaction ID must be a UUID.');
    }
    res.json(await repository.getTransaction(req.params.id.toLowerCase()));
  });
  router.get('/users', admin, async (req, res) => res.json(await userRepository.listUsers(dashboardReadQueries.users(req.query))));
  router.get('/dashboard/summary', async (req, res) => res.json(await repository.summary(dashboardReadQueries.summary(req.query))));
  router.get('/dashboard/stock-trends', async (req, res) => res.json(await repository.stockTrends(dashboardReadQueries.trends(req.query))));
  router.get('/dashboard/top-products', async (req, res) => res.json(await repository.topProducts(dashboardReadQueries.topProducts(req.query))));
  return router;
}
