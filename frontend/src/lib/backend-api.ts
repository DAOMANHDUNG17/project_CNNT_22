import { ApiError } from './api-types';
import type { RequestOptions } from './api-types';
import { supabase } from './supabase';

export async function authorizedGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Không thể đọc phiên đăng nhập.');
  if (!data.session) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập.');

  const apiUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api').replace(/\/$/, '');
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${data.session.access_token}` },
    signal: options.signal,
  });
  if (!response.ok) {
    const code = response.status === 400 && path.startsWith('/transactions') ? 'INVALID_QUERY'
      : response.status === 401 ? 'AUTHENTICATION_REQUIRED'
      : response.status === 403 ? 'FORBIDDEN' : 'REQUEST_FAILED';
    throw new ApiError(response.status, code, 'Không tải được dữ liệu từ backend.');
  }
  return (await response.json()) as T;
}

export async function authorizedPost<T>(path: string, body: object): Promise<T> {
  return (await authorizedPostWithStatus<T>(path, body)).data;
}

export async function authorizedPostWithStatus<T>(path: string, body: object): Promise<{ status: number; data: T }> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Không thể đọc phiên đăng nhập.');
  if (!data.session) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập.');

  const apiUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api').replace(/\/$/, '');
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const unitMessages: Record<string, string> = {
      'Product not found': 'PRODUCT_NOT_FOUND',
      'Product is inactive': 'PRODUCT_INACTIVE',
      'Scan code already exists': 'SCAN_CODE_CONFLICT',
      'Unit name already exists for this product': 'UNIT_NAME_CONFLICT',
      'Base unit already exists for this product': 'BASE_UNIT_CONFLICT',
      'Base unit conversion factor must be 1': 'BASE_UNIT_FACTOR_INVALID',
      'Base unit name must match the product base unit': 'BASE_UNIT_NAME_INVALID',
    };
    const payload = path === '/product-units' || path === '/stock-movements' ? await response.json().catch(() => null) as { message?: unknown } | null : null;
    const code = response.status === 400 ? 'INVALID_BODY'
      : response.status === 401 ? 'AUTHENTICATION_REQUIRED'
        : response.status === 403 ? 'FORBIDDEN'
          : response.status === 409 ? 'RESOURCE_CONFLICT' : 'REQUEST_FAILED';
    const unitCode = typeof payload?.message === 'string' ? unitMessages[payload.message] : undefined;
    if (path === '/stock-movements' && [404, 409].includes(response.status) && typeof payload?.message === 'string') {
      throw new ApiError(response.status, 'STOCK_MOVEMENT_ERROR', payload.message);
    }
    throw new ApiError(response.status, unitCode ?? code, 'Không thể lưu dữ liệu.');
  }
  return { status: response.status, data: (await response.json()) as T };
}

export async function authorizedPatch<T>(path: string, body: object): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Không thể đọc phiên đăng nhập.');
  if (!data.session) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập.');

  const apiUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api').replace(/\/$/, '');
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: unknown } | null;
    const unitMessages: Record<string, string> = {
      'Product unit not found': 'PRODUCT_UNIT_NOT_FOUND',
      'Scan code already exists': 'SCAN_CODE_CONFLICT',
      'Unit name already exists for this product': 'UNIT_NAME_CONFLICT',
      'Tên đơn vị cơ sở hiện không khớp với sản phẩm. Cần kiểm tra dữ liệu trước khi chỉnh sửa.': 'BASE_UNIT_DATA_MISMATCH',
      'Tên đơn vị cơ sở chưa thống nhất. Vui lòng nhập tên đơn vị để đồng bộ.': 'BASE_UNIT_SYNC_REQUIRED',
      'Cannot change the base unit conversion factor': 'BASE_UNIT_FACTOR_CHANGE_FORBIDDEN',
      'Không thể thay đổi hệ số quy đổi vì đơn vị này đã phát sinh giao dịch nhập/xuất.': 'UNIT_HAS_TRANSACTIONS',
      'Không thể thay đổi hệ số quy đổi khi sản phẩm vẫn còn tồn kho.': 'UNIT_PRODUCT_HAS_STOCK',
      'Inventory record missing': 'INVENTORY_NOT_FOUND',
    };
    const unitCode = path.startsWith('/product-units/') && typeof payload?.message === 'string'
      ? payload.message.startsWith('Cannot PATCH /api/product-units/') ? 'BACKEND_UNIT_ROUTE_MISSING'
        : unitMessages[payload.message]
      : undefined;
    const code = unitCode ?? (response.status === 400 ? 'INVALID_BODY'
      : response.status === 401 ? 'AUTHENTICATION_REQUIRED'
        : response.status === 403 ? 'FORBIDDEN'
          : response.status === 404 && typeof payload?.message === 'string' && payload.message.startsWith('Cannot PATCH /api/products/') ? 'BACKEND_ROUTE_MISSING'
            : response.status === 404 && payload?.message === 'Product not found' ? 'PRODUCT_NOT_FOUND'
            : response.status === 409 && payload?.message === 'Không thể ngừng hoạt động sản phẩm khi vẫn còn tồn kho.' ? 'PRODUCT_HAS_STOCK'
              : response.status === 409 && payload?.message === 'Inventory record missing' ? 'INVENTORY_NOT_FOUND'
                : response.status === 409 ? 'RESOURCE_CONFLICT' : 'REQUEST_FAILED');
    throw new ApiError(response.status, code, 'Không thể cập nhật dữ liệu.');
  }
  return (await response.json()) as T;
}
