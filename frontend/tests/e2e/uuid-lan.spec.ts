import { test, expect } from '@playwright/test';

test('UUID v4 works on a real insecure HTTP origin with randomUUID unavailable', async ({ page, baseURL }) => {
  // A non-localhost HTTP origin keeps normal browser security rules enabled.
  // Route only the QA module request to the local dev server; no VM/DNS changes are made.
  await page.route('http://warehouse-lan.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>LAN UUID QA</title>' });
    const upstream = await route.fetch({ url: `${baseURL}${path}` });
    return route.fulfill({ response: upstream });
  });
  await page.goto('http://warehouse-lan.test/');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/lib/transaction-id.ts';
    const { newTransactionId } = await import(/* @vite-ignore */ modulePath) as { newTransactionId: () => string };
    return { secure: window.isSecureContext, nativeUUID: typeof crypto.randomUUID, rng: typeof crypto.getRandomValues,
      ids: Array.from({ length: 100 }, () => newTransactionId()) };
  });
  expect(result.secure).toBe(false); expect(result.nativeUUID).toBe('undefined'); expect(result.rng).toBe('function');
  expect(result.ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
  expect(new Set(result.ids).size).toBe(100);
});
