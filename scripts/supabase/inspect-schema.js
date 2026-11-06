// Default: offline configuration validation. --connect is a real read-only DB connection.
// Do not run --connect until the user authorizes it after completing configuration.
import { loadCloudEnvironment } from '../lib/cloud-environment.js';
import { readCloudDiagnosticConfig } from '../../src/config/cloud.js';
import { inspectCloudCatalog } from '../../src/cloud/catalog-inspection.js';
import { writeFileSync } from 'node:fs';

let client;
try {
  if (process.argv.slice(2).some(arg => arg !== '--connect')) throw new Error('Only --connect is supported. Default mode is offline.');
  const config = readCloudDiagnosticConfig(loadCloudEnvironment());
  if (!process.argv.includes('--connect')) {
    console.info('Admin diagnostic configuration valid OFFLINE. No driver loaded or connection opened.');
  } else {
    const { default: pg } = await import('pg');
    client = new pg.Client(config.database);
    await client.connect();
    const report = await inspectCloudCatalog(client);
    writeFileSync(new URL('../../docs/SUPABASE_CATALOG_REPORT.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), projectRef: config.projectRef, ...report }, null, 2)+'\n');
    console.info('Saved catalog-only report. No business/Auth rows read; no migration or role change executed.');
  }
} catch (error) {
  // Driver messages may include connection details: only emit known code after creating a client.
  console.error(client ? `Catalog inspection failed (${/^[A-Z0-9_]{2,64}$/u.test(error.code ?? '') ? error.code : 'INSPECTION_FAILED'}).` : error.message);
  process.exitCode = 1;
} finally { if (client) await client.end().catch(() => {}); }
