import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseProductUnit, listDatabaseProductUnits, updateDatabaseProductUnit } from '../../src/lib/product-units-api';
import { errorMessage } from '../../src/lib/format';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { auth: { getSession } } }));

afterEach(() => {
  vi.unstubAllGlobals();
  getSession.mockReset();
});

describe('product units API', () => {
  const body = {
    product_id: 'SP013', unit_name: 'hộp', conversion_factor: 20,
    scan_code: 'SW-SP013-20', is_base_unit: false,
  };

  it('posts the given conversion factor with the Supabase bearer token and fetches updated units', async () => {
    const token = crypto.randomUUID();
    getSession.mockResolvedValue({ data: { session: { access_token: token } }, error: null });
    const unit = { ...body, product_unit_id: '9007199254740993', product_name: 'Product 13', created_at: '2026-01-02T00:00:00.000Z' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: unit }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [unit], count: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createDatabaseProductUnit(body)).resolves.toEqual({ data: unit });
    await expect(listDatabaseProductUnits()).resolves.toEqual({ data: [unit], count: 1 });
    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringMatching(/\/product-units$/), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('does not post without a session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(createDatabaseProductUnit(body)).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports duplicate scan code without fabricated data', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: crypto.randomUUID() } }, error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'Scan code already exists' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )));
    await expect(createDatabaseProductUnit(body)).rejects.toMatchObject({ status: 409, code: 'SCAN_CODE_CONFLICT' });
  });

  it('patches a BIGINT unit ID with the current Supabase bearer token', async () => {
    const token = crypto.randomUUID();
    getSession.mockResolvedValue({ data: { session: { access_token: token } }, error: null });
    const unit = { ...body, product_unit_id: '9007199254740993', product_name: 'Product 13', created_at: '2026-01-02T00:00:00.000Z' };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: unit }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(updateDatabaseProductUnit(unit.product_unit_id, { unit_name: 'hộp' })).resolves.toEqual({ data: unit });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/product-units\/9007199254740993$/), {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit_name: 'hộp' }),
    });
  });

  it('does not patch without a session and maps business conflicts', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValue({ data: { session: { access_token: crypto.randomUUID() } }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: 'Không thể thay đổi hệ số quy đổi vì đơn vị này đã phát sinh giao dịch nhập/xuất.',
    }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(updateDatabaseProductUnit('29', { conversion_factor: 120 })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(updateDatabaseProductUnit('29', { conversion_factor: 120 })).rejects.toMatchObject({
      status: 409, code: 'UNIT_HAS_TRANSACTIONS',
    });
  });

  it('shows an inconsistent base unit error and identifies a backend missing the PATCH route', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: crypto.randomUUID() } }, error: null });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Cannot PATCH /api/product-units/29' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: 'Tên đơn vị cơ sở hiện không khớp với sản phẩm. Cần kiểm tra dữ liệu trước khi chỉnh sửa.',
      }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(updateDatabaseProductUnit('29', { unit_name: 'Chiếc' })).rejects.toMatchObject({
      status: 404, code: 'BACKEND_UNIT_ROUTE_MISSING',
    });
    try {
      await updateDatabaseProductUnit('29', { unit_name: 'Chiếc' });
      throw new Error('Expected a conflict');
    } catch (error) {
      expect(error).toMatchObject({ status: 409, code: 'BASE_UNIT_DATA_MISMATCH' });
      expect(errorMessage(error)).toBe('Tên đơn vị cơ sở hiện không khớp với sản phẩm. Cần kiểm tra dữ liệu trước khi chỉnh sửa.');
    }
  });
});
