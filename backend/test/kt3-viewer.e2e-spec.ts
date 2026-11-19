import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { JwtVerifierService } from '../src/auth/jwt-verifier.service';
import { SupabaseAdminService } from '../src/users/supabase-admin.service';

describe('KT3 VIEWER HTTP permissions (isolated doubles)', () => {
  let app: INestApplication<App>;
  const query = jest.fn();
  const transaction = jest.fn();
  const provision = jest.fn();
  const viewer = {
    user_id: '3', auth_user_id: '00000000-0000-4000-8000-000000000003',
    username: 'viewer.qa', display_name: 'Viewer QA', role: 'VIEWER', is_active: true,
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService).useValue({ query, transaction })
      .overrideProvider(JwtVerifierService).useValue({ verify: async () => viewer.auth_user_id })
      .overrideProvider(SupabaseAdminService).useValue({ create: provision, remove: provision })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  beforeEach(() => {
    query.mockReset().mockImplementation(async (sql: string) =>
      sql.includes('FROM public.users WHERE auth_user_id = $1') ? [viewer] : []);
    transaction.mockReset();
    provision.mockReset();
  });

  afterAll(async () => { await app.close(); });

  const bearer = (method: 'get' | 'post' | 'patch' | 'put', path: string) =>
    request(app.getHttpServer())[method](path).set('Authorization', 'Bearer fixture-viewer-token');

  it.each([
    ['GET', '/api/auth/me'],
    ['GET', '/api/products'],
    ['GET', '/api/product-units'],
    ['GET', '/api/inventory'],
    ['GET', '/api/scan-points'],
    ['GET', '/api/scan-points/my'],
    ['GET', '/api/transactions'],
    ['GET', '/api/dashboard'],
  ])('allows VIEWER %s %s using only SELECT', async (_method, path) => {
    await bearer('get', path).expect(200);
    expect(transaction).not.toHaveBeenCalled();
    expect(query.mock.calls.every(([sql]) => /^\s*(SELECT|WITH)\b/i.test(String(sql)))).toBe(true);
  });

  it.each([
    ['post', '/api/products', { product_id: 'QA-KT3', product_name: 'QA', base_unit: 'cai' }],
    ['patch', '/api/products/QA-KT3', { product_name: 'changed' }],
    ['post', '/api/product-units', { product_id: 'QA-KT3', unit_name: 'hop', conversion_factor: 1, scan_code: 'QA-KT3', is_base_unit: true }],
    ['patch', '/api/product-units/1', { scan_code: 'QA-KT3-EDIT' }],
    ['post', '/api/stock-movements', { transaction_id: '550e8400-e29b-41d4-a716-446655440000', scan_code: 'QA-KT3', scan_point_id: 'SCAN-01', movement_type: 'IN' }],
    ['post', '/api/users', { username: 'new.qa', display_name: 'New QA', email: 'new@example.test', password: 'fixture-only-password', role: 'STAFF' }],
    ['patch', '/api/users/1', { role: 'VIEWER' }],
    ['put', '/api/users/1/scan-points', { scan_point_ids: [] }],
  ] as const)('returns 403 before any mutation for VIEWER %s %s', async (method, path, body) => {
    await bearer(method, path).send(body).expect(403);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain('FROM public.users WHERE auth_user_id = $1');
    expect(transaction).not.toHaveBeenCalled();
    expect(provision).not.toHaveBeenCalled();
  });
});
