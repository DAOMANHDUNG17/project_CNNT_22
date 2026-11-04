import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const specification = JSON.parse(readFileSync(new URL('../../docs/openapi.json', import.meta.url), 'utf8'));
export const operations = Object.entries(specification.paths).flatMap(([path, item]) =>
  Object.entries(item).filter(([method]) => ['get','post','patch','put','delete'].includes(method))
    .map(([method, operation]) => ({ path, method: method.toUpperCase(), ...operation })));

// This deliberately supports exactly the schema keywords used in this contract.
// Fail on a new unsupported keyword so the check cannot silently weaken.
const keywords = new Set(['$ref','type','properties','required','additionalProperties','items','enum','const',
  'minimum','maximum','minLength','maxLength','pattern','format','minProperties','description','default','writeOnly']);
export function assertSchema(value, schema, path = '$') {
  assert.ok(schema && typeof schema === 'object', `${path}: schema exists`);
  for (const key of Object.keys(schema)) assert.ok(keywords.has(key), `${path}: unsupported schema keyword ${key}`);
  if (schema.$ref) {
    assert.ok(schema.$ref.startsWith('#/'), `${path}: local reference`);
    const target = schema.$ref.slice(2).split('/').reduce((entry, key) => entry?.[key], specification);
    return assertSchema(value, target, path);
  }
  if (schema.type === 'object') {
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${path}: object`);
    const keys = Object.keys(value);
    for (const key of schema.required ?? []) assert.ok(Object.hasOwn(value, key), `${path}.${key}: required`);
    if (schema.minProperties !== undefined) assert.ok(keys.length >= schema.minProperties, `${path}: minProperties`);
    for (const key of keys) {
      if (schema.additionalProperties === false) assert.ok(Object.hasOwn(schema.properties ?? {}, key), `${path}.${key}: unexpected field`);
      if (schema.properties?.[key]) assertSchema(value[key], schema.properties[key], `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    assert.ok(Array.isArray(value), `${path}: array`);
    value.forEach((item, i) => assertSchema(item, schema.items, `${path}[${i}]`));
  } else if (schema.type) {
    assert.ok(schema.type === 'integer' ? Number.isInteger(value) : typeof value === schema.type, `${path}: ${schema.type}`);
  }
  if (schema.enum) assert.ok(schema.enum.includes(value), `${path}: enum`);
  if (Object.hasOwn(schema, 'const')) assert.ok(value === schema.const, `${path}: const`);
  if (schema.minimum !== undefined) assert.ok(value >= schema.minimum, `${path}: minimum`);
  if (schema.maximum !== undefined) assert.ok(value <= schema.maximum, `${path}: maximum`);
  if (schema.minLength !== undefined) assert.ok([...value].length >= schema.minLength, `${path}: minLength`);
  if (schema.maxLength !== undefined) assert.ok([...value].length <= schema.maxLength, `${path}: maxLength`);
  if (schema.pattern) assert.ok(new RegExp(schema.pattern, 'u').test(value), `${path}: pattern`);
  if (schema.format === 'date-time') assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)), `${path}: UTC timestamp`);
  else if (schema.format === 'uuid') assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value), `${path}: UUID`);
  else if (schema.format === 'date') assert.ok(/^\d{4}-\d\d-\d\d$/u.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value, `${path}: date`);
  else if (schema.format === 'uri') assert.doesNotThrow(() => new URL(value), `${path}: URI`);
  else assert.ok(!schema.format, `${path}: unsupported format`);
}

export function findOperation(method, pathname) {
  // Static routes (low-stock) take precedence over a parameter template.
  const candidates = operations.filter(op => op.method === method).sort((a,b) => Number(a.path.includes('{')) - Number(b.path.includes('{')));
  return candidates.find(op => {
    const template = op.path.split('/'), actual = pathname.split('/');
    return template.length === actual.length && template.every((part,i) => part.startsWith('{') ? !!actual[i] : part === actual[i]);
  });
}

export function assertResponse(operation, status, payload) {
  const response = operation.responses[String(status)];
  assert.ok(response, `${operation.operationId}: HTTP ${status} is documented`);
  const schema = response.content?.['application/json']?.schema;
  if (schema) assertSchema(payload, schema, operation.operationId);
  else assert.equal(payload, null, `${operation.operationId}: empty response`);
}
