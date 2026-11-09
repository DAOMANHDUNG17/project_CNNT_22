import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseProduct, updateDatabaseProduct } from '../../src/lib/products-api';

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

describe('updateDatabaseProduct', () => {
  it('sends PATCH with only changed fields and the current Supabase bearer token', async () => {
    const token = crypto.randomUUID();
    getSession.mockResolvedValue({ data: { session: { access_token: token } }, error: null });
    const updated = { product_id: 'SP013', product_name: 'Bút mực Hồng Hà', base_unit: 'cây', is_active: true };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: updated }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(updateDatabaseProduct('SP013', { product_name: updated.product_name })).resolves.toEqual({ data: updated });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/products\/SP013$/), {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_name: updated.product_name }),
    });
  });

  it('does not send PATCH without a session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(updateDatabaseProduct('SP013', { is_active: false })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps stock conflict to a specific error', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: crypto.randomUUID() } }, error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'Không thể ngừng hoạt động sản phẩm khi vẫn còn tồn kho.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )));
    await expect(updateDatabaseProduct('SP013', { is_active: false })).rejects.toMatchObject({ status: 409, code: 'PRODUCT_HAS_STOCK' });
  });

  it('distinguishes a stale backend without PATCH from an unknown product', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: crypto.randomUUID() } }, error: null });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Cannot PATCH /api/products/SP013' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Product not found' }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(updateDatabaseProduct('SP013', { product_name: 'New' })).rejects.toMatchObject({ status: 404, code: 'BACKEND_ROUTE_MISSING' });
    await expect(updateDatabaseProduct('SP013', { product_name: 'New' })).rejects.toMatchObject({ status: 404, code: 'PRODUCT_NOT_FOUND' });
  });
});
