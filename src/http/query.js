import { HttpError } from './errors.js';

const invalid = (message) => new HttpError(400, 'INVALID_QUERY', message);

export function text(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > maxLength || value.includes('\0')) {
    throw invalid(`${name} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

export function validateKeys(query, allowed = []) {
  for (const [name, value] of Object.entries(query)) {
    if (!allowed.includes(name) || typeof value !== 'string') {
      throw invalid(`Unsupported or repeated query parameter: ${allowed.includes(name) ? name : 'unknown'}.`);
    }
  }
}

export function listQuery(query, filters = []) {
  validateKeys(query, ['page', 'limit', ...filters]);
  const number = (name, fallback, max = Number.MAX_SAFE_INTEGER) => {
    const raw = query[name] ?? String(fallback);
    const value = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(value) || value > max) {
      throw invalid(`${name} must be a positive integer${name === 'limit' ? ' no greater than 100' : ''}.`);
    }
    return value;
  };
  const page = number('page', 1);
  const limit = number('limit', 20, 100);
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) throw invalid('Pagination offset is too large.');
  const result = { page, limit, offset };
  for (const name of filters) {
    if (query[name] !== undefined) result[name] = text(query[name], name, name === 'q' ? 150 : 20);
  }
  if (result.movementType !== undefined && !['IN', 'OUT'].includes(result.movementType)) {
    throw invalid('movementType must be IN or OUT.');
  }
  return result;
}

// An explicit escape character makes backslashes literal as well.
export const likePattern = (value) => `%${value.replace(/[!%_]/gu, '!$&')}%`;
