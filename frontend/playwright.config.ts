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
  reporter: 'list',
  use: { baseURL:process.env.E2E_BASE_URL ?? 'http://localhost:5173',browserName:'chromium',channel:'msedge',headless:true,
    viewport:{width:1440,height:1000},actionTimeout:12000, trace:'off',video:'off',screenshot:'off' },
});
