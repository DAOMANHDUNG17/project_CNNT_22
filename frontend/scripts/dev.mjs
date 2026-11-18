import { parseArgs } from 'node:util';
import { availableDevHosts, devUrl, hostOnlyAddresses, startDev } from '../config/multi-host.ts';

try {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '5173' } } });
  const port = Number(values.port);
  if (!/^\d+$/.test(values.port) || !Number.isInteger(port) || port > 65535) throw new Error('--port must be an integer from 0 to 65535.');
  const hosts = availableDevHosts();
  const dev = await startDev({ port, hosts });
  const shutdown = () => { void dev.close().catch(error => { console.error(error.message); process.exitCode = 1; }); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  console.log('\n  Smart Warehouse frontend ready');
  console.log(`  Local:   http://localhost:${dev.port}/`);
  for (const host of hostOnlyAddresses) {
    if (hosts.includes(host)) console.log(`  LAN:     ${devUrl(host, dev.port)}`);
    else console.warn(`  LAN ${host} is not assigned to this Windows host; that listener was skipped.`);
  }
  console.log('  Ctrl+C stops all frontend listeners.\n');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
