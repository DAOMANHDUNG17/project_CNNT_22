import { test, expect } from '@playwright/test';

test('unauthenticated visitors cannot load Products', async ({ page }) => {
  let productsRequests = 0;
  page.on('request', request => {
    if (request.url().endsWith('/api/products')) productsRequests++;
  });
  await page.goto('/products');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  expect(productsRequests).toBe(0);
});

test('Supabase login loads real products and persists across refresh', async ({ page }) => {
  const email = process.env.E2E_SUPABASE_EMAIL;
  const password = process.env.E2E_SUPABASE_PASSWORD;
  test.skip(!email || !password, 'Set E2E_SUPABASE_EMAIL and E2E_SUPABASE_PASSWORD locally to run live login test');

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email!);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/products'));
  await page.goto('/products');

  const response = await responsePromise;
  expect(response.request().headers().authorization).toMatch(/^Bearer [^\s]+$/);
  expect(response.status()).toBe(200);
  const payload = await response.json() as { count: number; data: Array<{ product_id: string }> };
  expect(payload.count).toBe(12);
  expect(payload.data).toHaveLength(12);
  await expect(page.getByRole('row').filter({ hasText: payload.data[0]!.product_id })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: payload.data[0]!.product_id })).toBeVisible();
});
