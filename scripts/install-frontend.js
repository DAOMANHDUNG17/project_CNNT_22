import { spawnSync } from 'node:child_process';
// npm supplies its own CLI path on Windows as well: no shell interpolation.
const cli = process.env.npm_execpath;
if (!cli) throw new Error('Run this setup through npm install.');
const result = spawnSync(process.execPath, [cli, '--prefix', 'frontend', 'ci', '--no-audit', '--no-fund'], { stdio: 'inherit' });
if (result.error) throw new Error('Frontend dependency installation could not start.');
process.exitCode = result.status ?? 1;
