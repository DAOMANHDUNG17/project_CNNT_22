// LEGACY REFERENCE ONLY: retired API contract; do not treat as the new backend specification.
// Browser-side integration example, not a frontend application.
// Keep the same-origin /api proxy. Never store session cookies/passwords/hashes.
export type DecimalString = string;
export type BigintId = string;
export type IsoTimestamp = string;
export type Role = 'ADMIN' | 'KEEPER' | 'STAFF' | 'VIEWER';
export type MovementType = 'IN' | 'OUT';
export interface Data<T> { data: T }
export interface Page<T> {
  data: T[];
  count: number;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
export interface PaginationQuery { page?: number; limit?: number }
export interface Identity { user_id: BigintId; username: string; display_name: string; role: Role }
export interface User extends Identity { is_active: boolean; created_at: IsoTimestamp }
export interface Product { product_id: string; product_name: string; base_unit: string; is_active: boolean; created_at: IsoTimestamp }
export interface ProductUnit { product_unit_id: BigintId; product_id: string; unit_name: string; conversion_factor: number; scan_code: string; is_base_unit: boolean }
export interface ProductDetail extends Product { units: ProductUnit[] }
export interface Inventory { product_id: string; product_name: string; base_unit: string; is_active: boolean; quantity_base: DecimalString; updated_at: IsoTimestamp }
export interface ScanPoint { scan_point_id: string; point_name: string; is_active: boolean }
export interface Movement {
  transaction_id: string; product_id: string; product_unit_id: BigintId; scan_point_id: string;
  movement_type: MovementType; quantity_packages: number; conversion_factor_snapshot: number;
  quantity_base: DecimalString; inventory_after: DecimalString; created_at: IsoTimestamp;
}
export interface Transaction extends Movement { product_name: string; unit_name: string; point_name: string }
export interface MovementRequest {
  transaction_id: string; scan_point_id: string; scan_code: string;
  movement_type: MovementType; quantity_packages: number;
}
export interface MovementResponse extends Data<Movement> { meta: { result_status: 'CREATED' | 'DUPLICATE' } }
export interface ProductCreate { product_id: string; product_name: string; base_unit: string; is_active?: boolean }
export interface ProductPatch { product_name?: string; base_unit?: string }
export interface UnitCreate { unit_name: string; conversion_factor: number; scan_code: string; is_base_unit?: boolean }
export interface UnitPatch { unit_name?: string; conversion_factor?: number; is_base_unit?: boolean }
export interface ScanPointCreate { scan_point_id: string; point_name: string; is_active?: boolean }
export interface ScanPointPatch { point_name?: string; is_active?: boolean }
export interface UserCreate { username: string; display_name: string; role: Role; password: string; is_active?: boolean }
export interface UserPatch { username?: string; display_name?: string; role?: Role }
export interface ProductQuery extends PaginationQuery { q?: string }
export interface LowStockQuery extends PaginationQuery { threshold?: DecimalString; q?: string }
export interface TransactionQuery extends PaginationQuery { productId?: string; movementType?: MovementType; scanPointId?: string }
export interface UserQuery extends PaginationQuery { q?: string; role?: Role; isActive?: boolean }
export interface DateRangeQuery { from?: string; to?: string }
export interface TrendQuery extends PaginationQuery, DateRangeQuery {
  granularity?: 'day' | 'month'; productId?: string; movementType?: MovementType; scanPointId?: string;
}
interface TopProductsFilters extends PaginationQuery, DateRangeQuery {
  productId?: string; movementType?: MovementType; scanPointId?: string;
  q?: string;
}
export type TopProductsQuery = TopProductsFilters & (
  { sortBy?: 'transactions'; baseUnit?: string } |
  { sortBy: 'inQuantity' | 'outQuantity'; baseUnit: string }
);
export interface Trend { period_start: IsoTimestamp; in_count: DecimalString; out_count: DecimalString; total_count: DecimalString }
export interface TopProduct {
  product_id: string; product_name: string; base_unit: string; transaction_count: DecimalString;
  in_count: DecimalString; out_count: DecimalString; quantity_in_base: DecimalString; quantity_out_base: DecimalString;
}
export interface Summary {
  products: { total: DecimalString; active: DecimalString; inactive: DecimalString; missing_inventory: DecimalString };
  inventory_totals: Array<{ base_unit: string; quantity_base: DecimalString }>;
  transactions: { IN: DecimalString; OUT: DecimalString; total: DecimalString };
  low_stock: { threshold: DecimalString; product_count: DecimalString };
}
export interface Health { status: 'ok'; database: 'connected' }
type RequestOptions = { signal?: AbortSignal };
type Query = Record<string, string | number | boolean | undefined>;
type ApiFailure = { error?: { code?: string; message?: string } };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: number | undefined;
  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export class WarehouseApi {
  private csrfToken: string | undefined;
  private readonly baseUrl: string;
  private readonly bearer?: { getAccessToken: () => Promise<string | null> };
  constructor(baseUrl = '/api', bearer?: { getAccessToken: () => Promise<string | null> }) {
    this.bearer = bearer;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    if (bearer && !/^\/api(?:\/[A-Za-z0-9_-]+)*$/u.test(this.baseUrl)) throw new Error('Bearer API must use a same-origin path.');
  }

  private async send<T>(method: string, path: string,
    options: RequestOptions & { query?: object; body?: object; csrf?: boolean } = {}): Promise<T> {
    const parameters = new URLSearchParams();
    for (const [name, value] of Object.entries(options.query ?? {}) as Array<[string, Query[string]]>) {
      if (value !== undefined) parameters.set(name, String(value));
    }
    const suffix = parameters.size ? `?${parameters.toString()}` : '';
    const headers = new Headers({ Accept: 'application/json' });
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (this.bearer) {
      const token = await this.bearer.getAccessToken();
      if (!token && path !== '/health') throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }
    if (options.csrf && !this.bearer) {
      if (!this.csrfToken) await this.csrf({ signal: options.signal });
      headers.set('X-CSRF-Token', this.csrfToken!);
    }
    // Browser supplies Origin automatically on unsafe requests. Do not forge it.
    const response = await fetch(`${this.baseUrl}${path}${suffix}`, {
      method, headers, credentials: this.bearer ? 'omit' : 'include', cache: 'no-store', signal: options.signal,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    if (response.status === 204) return undefined as T;
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) this.csrfToken = undefined;
      const failure = payload as ApiFailure | null;
      const retry = response.headers.get('Retry-After');
      throw new ApiError(response.status, failure?.error?.code ?? 'HTTP_ERROR',
        failure?.error?.message ?? 'The request failed.', retry && /^\d+$/.test(retry) ? Number(retry) : undefined);
    }
    return payload as T;
  }

  async login(username: string, password: string, options: RequestOptions = {}): Promise<Data<Identity>> {
    if (this.bearer) throw new Error('Sign in with the Auth provider, then confirmLogin().');
    this.csrfToken = undefined;
    return this.send('POST', '/auth/login', { ...options, body: { username, password } });
  }
  async logout(options: RequestOptions = {}): Promise<void> {
    if (this.bearer) return this.send('POST', '/auth/logout', options);
    // If CSRF fetch says the session is absent, still ask the server to clear
    // the stale HttpOnly cookie. JavaScript cannot clear it directly.
    try { await this.send<void>('POST', '/auth/logout', { ...options, csrf: true }); }
    catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
      await this.send<void>('POST', '/auth/logout', options);
    }
    finally { this.csrfToken = undefined; }
  }
  me(options: RequestOptions = {}): Promise<Data<Identity>> { return this.send('GET', '/auth/me', options); }
  async csrf(options: RequestOptions = {}): Promise<Data<{ csrf_token: string }>> {
    if (this.bearer) throw new Error('Bearer mode uses authCapabilities(), not a CSRF token.');
    const result = await this.send<Data<{ csrf_token: string }>>('GET', '/auth/csrf', options);
    this.csrfToken = result.data.csrf_token;
    return result;
  }
  confirmLogin(options: RequestOptions = {}): Promise<Data<Identity>> {
    if (!this.bearer) throw new Error('confirmLogin requires Bearer mode.');
    return this.send('POST', '/auth/login', { ...options, body: {} });
  }
  authCapabilities(options: RequestOptions = {}): Promise<Data<{ mode: 'bearer'; csrf_required: false }>> {
    if (!this.bearer) throw new Error('authCapabilities requires Bearer mode.');
    return this.send('GET', '/auth/csrf', options);
  }
  health(options: RequestOptions = {}): Promise<Health> { return this.send('GET', '/health', options); }

  listProducts(query: ProductQuery = {}, options: RequestOptions = {}): Promise<Page<Product>> { return this.send('GET', '/products', { ...options, query }); }
  getProduct(id: string, options: RequestOptions = {}): Promise<Data<ProductDetail>> { return this.send('GET', `/products/${encodeURIComponent(id)}`, options); }
  createProduct(body: ProductCreate): Promise<Data<Product>> { return this.send('POST', '/products', { body, csrf: true }); }
  updateProduct(id: string, body: ProductPatch): Promise<Data<Product>> { return this.send('PATCH', `/products/${encodeURIComponent(id)}`, { body, csrf: true }); }
  setProductStatus(id: string, is_active: boolean): Promise<Data<Product>> { return this.send('PATCH', `/products/${encodeURIComponent(id)}/status`, { body: { is_active }, csrf: true }); }
  addProductUnit(id: string, body: UnitCreate): Promise<Data<ProductUnit>> { return this.send('POST', `/products/${encodeURIComponent(id)}/units`, { body, csrf: true }); }
  updateProductUnit(id: BigintId, body: UnitPatch): Promise<Data<ProductUnit>> { return this.send('PATCH', `/product-units/${encodeURIComponent(id)}`, { body, csrf: true }); }

  listInventory(query: PaginationQuery = {}, options: RequestOptions = {}): Promise<Page<Inventory>> { return this.send('GET', '/inventory', { ...options, query }); }
  getInventory(productId: string, options: RequestOptions = {}): Promise<Data<Inventory>> { return this.send('GET', `/inventory/${encodeURIComponent(productId)}`, options); }
  lowStock(query: LowStockQuery = {}, options: RequestOptions = {}): Promise<Page<Inventory>> { return this.send('GET', '/inventory/low-stock', { ...options, query }); }
  listTransactions(query: TransactionQuery = {}, options: RequestOptions = {}): Promise<Page<Transaction>> { return this.send('GET', '/transactions', { ...options, query }); }
  getTransaction(id: string, options: RequestOptions = {}): Promise<Data<Transaction>> { return this.send('GET', `/transactions/${encodeURIComponent(id)}`, options); }
  recordTransaction(body: MovementRequest): Promise<MovementResponse> { return this.send('POST', '/transactions', { body, csrf: true }); }

  listScanPoints(query: PaginationQuery = {}, options: RequestOptions = {}): Promise<Page<ScanPoint>> { return this.send('GET', '/scan-points', { ...options, query }); }
  createScanPoint(body: ScanPointCreate): Promise<Data<ScanPoint>> { return this.send('POST', '/scan-points', { body, csrf: true }); }
  updateScanPoint(id: string, body: ScanPointPatch): Promise<Data<ScanPoint>> { return this.send('PATCH', `/scan-points/${encodeURIComponent(id)}`, { body, csrf: true }); }
  listUsers(query: UserQuery = {}, options: RequestOptions = {}): Promise<Page<User>> { return this.send('GET', '/users', { ...options, query }); }
  createUser(body: UserCreate): Promise<Data<User>> { return this.send('POST', '/users', { body, csrf: true }); }
  updateUser(id: BigintId, body: UserPatch): Promise<Data<User>> { return this.send('PATCH', `/users/${encodeURIComponent(id)}`, { body, csrf: true }); }
  setUserStatus(id: BigintId, is_active: boolean): Promise<Data<User>> { return this.send('PATCH', `/users/${encodeURIComponent(id)}/status`, { body: { is_active }, csrf: true }); }
  resetUserPassword(id: BigintId, password: string): Promise<Data<User>> { return this.send('POST', `/users/${encodeURIComponent(id)}/reset-password`, { body: { password }, csrf: true }); }

  summary(threshold: DecimalString = '10', options: RequestOptions = {}): Promise<Data<Summary>> { return this.send('GET', '/dashboard/summary', { ...options, query: { threshold } }); }
  stockTrends(query: TrendQuery = {}, options: RequestOptions = {}): Promise<Page<Trend>> { return this.send('GET', '/dashboard/stock-trends', { ...options, query }); }
  topProducts(query: TopProductsQuery = {}, options: RequestOptions = {}): Promise<Page<TopProduct>> { return this.send('GET', '/dashboard/top-products', { ...options, query }); }
}
