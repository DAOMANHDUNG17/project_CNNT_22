import { defineConfig } from '@playwright/test';
// Playwright AI error snapshots may include password input values. Disable
// those snapshots; keep normal assertions and our credential-free screenshots.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 12000 },
  reporter: [['json',{ outputFile: 'test-results/e2e-results.json' }]],
  use: { baseURL:'http://127.0.0.1:5173',browserName:'chromium',channel:'msedge',headless:true,
    viewport:{width:1440,height:1000},actionTimeout:12000, trace:'off',video:'off',screenshot:'off' },
  webServer: [
    // Never reuse an unknown backend: the launcher asserts the test DB marker.
    {command:'node scripts/start-test-backend.mjs',url:'http://127.0.0.1:3000/api/health',reuseExistingServer:false,timeout:20000},
    {command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:false,timeout:20000},
  ],
});
