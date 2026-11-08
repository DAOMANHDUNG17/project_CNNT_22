import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseProduct } from '../../src/lib/products-api';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { auth: { getSession } } }));

afterEach(() => {
  vi.unstubAllGlobals();
  getSession.mockReset();
});

describe('createDatabaseProduct', () => {
  const product = { product_id: 'SP013', product_name: 'New product', base_unit: 'piece' };

  it('posts only product fields with the current Supabase access token', async () => {
    const accessToken = crypto.randomUUID();
    getSession.mockResolvedValue({ data: { session: { access_token: accessToken } }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: product }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createDatabaseProduct(product)).resolves.toEqual({ data: product });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/products$/), {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(product),
    });
  });

  it('does not post without a session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(createDatabaseProduct(product)).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports duplicate product IDs without claiming success', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: crypto.randomUUID() } }, error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 409 })));

    await expect(createDatabaseProduct(product)).rejects.toMatchObject({ status: 409, code: 'PRODUCT_ID_CONFLICT' });
  });
});
