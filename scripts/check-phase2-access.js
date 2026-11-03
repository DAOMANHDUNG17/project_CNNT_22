import { readConfig } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { checkPhase2Access } from './lib/phase2-access.js';

let db;
try {
  const config = readConfig();
  if (config.schema !== 'public') throw Object.assign(new Error('Phase 2 requires the inspected public schema.'), { code: 'SCHEMA_MISMATCH' });
  db = createPool(config.database);
  console.info(JSON.stringify(await checkPhase2Access(db), null, 2));
} catch (error) {
  console.error({ event: 'phase2_preflight_failed', code: error.code || 'CONFIG_ERROR', tables: error.tables || [] });
  console.error('No privileges changed. Review the manual pgAdmin instructions in README.md.');
  process.exitCode = 1;
} finally {
  if (db) await db.end();
}
