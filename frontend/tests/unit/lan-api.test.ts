import { afterEach, expect, it, vi } from 'vitest';
import { authorizedGet, authorizedPatch, authorizedPost, authorizedPut } from '../../src/lib/backend-api';
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); getSession.mockReset(); });
it('LAN API clients use same-origin /api for every method and keep JWT and retry payload intact', async () => {
  vi.stubEnv('VITE_API_URL', '/api'); getSession.mockResolvedValue({ data: { session: { access_token: 'qa-token' } }, error: null });
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: [] })))); vi.stubGlobal('fetch', fetchMock);
  const payload = { transaction_id: '10000000-0000-4000-8000-000000000001', scan_code: 'BOX24', scan_point_id: 'SCAN-01', movement_type: 'IN', quantity_packages: 1 };
  await authorizedGet('/transactions?page=2'); await authorizedPost('/stock-movements', payload); await authorizedPost('/stock-movements', payload);
  await authorizedPatch('/users/2', { display_name: 'QA' }); await authorizedPut('/users/2/scan-points', { scan_point_ids: ['SCAN-01'] });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/transactions?page=2', '/api/stock-movements', '/api/stock-movements', '/api/users/2', '/api/users/2/scan-points']);
  expect(fetchMock.mock.calls.every(([, options]) => options.headers.Authorization === 'Bearer qa-token')).toBe(true);
  expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[2]![1].body);
});
