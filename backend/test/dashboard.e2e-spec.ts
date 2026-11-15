import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { JwtVerifierService } from '../src/auth/jwt-verifier.service';

describe('GET /api/dashboard', () => {
  let app: INestApplication<App>;
  const query = jest.fn();
  const verify = jest.fn();
  let role = 'ADMIN';
  const rows = (sql: string) => {
    if (sql.includes('WHERE auth_user_id')) return [{ role, is_active: true }];
    if (sql.includes('missing_inventory')) return [{ total: '2', active: '1', inactive: '1', missing_inventory: '1' }];
    if (sql.includes('GROUP BY p.base_unit')) return [{ base_unit: 'Hộp', quantity_base: '9007199254740993' }];
    if (sql.includes('WITH ranked')) return [{ total: '1', product_id: 'SP013', product_name: 'Paper', base_unit: 'Hộp', transaction_count: '1', in_count: '1', out_count: '0', quantity_in_base: '9007199254740993', quantity_out_base: '0' }];
    if (sql.includes('AS in_count') && !sql.includes('date_trunc')) return [{ total: '1', in_count: '1', out_count: '0' }];
    if (sql.includes('AS product_count')) return [{ product_count: '1' }];
    if (sql.includes('date_trunc')) return [{ period: '2026-11-14', in_count: '1', out_count: '0', total_count: '1' }];
    if (sql.includes('ORDER BY t.created_at DESC')) return [{ transaction_id: 'id', product_name: 'Paper', movement_type: 'IN', quantity_packages: 1, unit_name: 'Hộp', point_name: 'Gate', created_at: new Date('2026-11-14T00:00:00Z') }];
    return [{ product_id: 'SP013', product_name: 'Paper', base_unit: 'Hộp', quantity_base: '0' }];
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService).useValue({ query })
      .overrideProvider(JwtVerifierService).useValue({ verify }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(() => { role = 'ADMIN'; query.mockReset().mockImplementation(rows); verify.mockReset().mockResolvedValue('00000000-0000-4000-8000-000000000001'); });
  afterAll(async () => { await app.close(); });
  const get = (suffix = '') => request(app.getHttpServer()).get(`/api/dashboard${suffix}`).set('Authorization', 'Bearer token');

  it.each(['ADMIN', 'STAFF', 'VIEWER'])('allows %s and preserves exact quantities', async value => {
    role = value;
    const response = await get().expect(200);
    expect(response.body.summary).toMatchObject({ products: { total: '2', missing_inventory: '1' }, transactions: { IN: '1', OUT: '0' }, inventory_totals: [{ quantity_base: '9007199254740993' }] });
    expect(response.body.top.data[0].quantity_in_base).toBe('9007199254740993');
    expect(response.body.low_stock[0].quantity_base).toBe('0');
    expect(response.body.trends[0].period_start).toBe('2026-11-14T00:00:00Z');
    expect(response.body.latest).toHaveLength(1);
  });

  it('requires JWT and permitted role', async () => {
    await request(app.getHttpServer()).get('/api/dashboard').expect(401);
    verify.mockRejectedValueOnce(new Error('invalid'));
    await get().expect(401);
    role = 'KEEPER';
    await get().expect(403);
  });

  it.each(['from=bad', 'to=2026-02-30', 'from=2026-11-15&to=2026-11-14', 'granularity=week', 'page=0', 'limit=101', 'unknown=true'])('rejects %s before dashboard SQL', async suffix => {
    await get(`?${suffix}`).expect(400);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes('public.stock_transactions'))).toHaveLength(0);
  });

  it('parameterizes inclusive UTC dates and pagination and performs SELECT only', async () => {
    await get('?from=2026-11-01&to=2026-11-14&granularity=month&page=2&limit=3').expect(200);
    const calls = query.mock.calls.slice(1);
    expect(calls.every(([sql]) => /^\s*(SELECT|WITH)\b/i.test(sql))).toBe(true);
    expect(calls.map(([sql]) => sql).join(' ')).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(calls.find(([sql]) => String(sql).includes('date_trunc'))?.[1]).toEqual(['2026-11-01', '2026-11-14', 'month']);
    expect(calls.find(([sql]) => String(sql).includes('WITH ranked'))?.[1]).toEqual(['2026-11-01', '2026-11-14', 3, '3']);
    expect(calls.find(([sql]) => String(sql).includes('date_trunc'))?.[0]).toContain("($2::date + 1)");
  });

  it('returns empty lists and zero counts without fabricating OUT', async () => {
    query.mockImplementation((sql: string) => sql.includes('WHERE auth_user_id') ? [{ role: 'ADMIN', is_active: true }] : sql.includes('missing_inventory') ? [{ total: '0', active: '0', inactive: '0', missing_inventory: '0' }] : sql.includes('AS in_count') && !sql.includes('date_trunc') ? [{ total: '0', in_count: '0', out_count: '0' }] : sql.includes('AS product_count') ? [{ product_count: '0' }] : sql.includes('WITH ranked') ? [{ total: '0', product_id: null }] : []);
    const response = await get().expect(200);
    expect(response.body.summary.transactions).toEqual({ IN: '0', OUT: '0', total: '0' });
    expect(response.body.trends).toEqual([]);
    expect(response.body.top.data).toEqual([]);
    expect(response.body.latest).toEqual([]);
    expect(response.body.low_stock).toEqual([]);
  });

  it('documents exactly one read-only dashboard operation', () => {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
    expect(doc.paths['/api/dashboard']?.get?.security).toEqual([{ bearer: [] }]);
    expect(doc.paths['/api/dashboard']?.get?.parameters).toHaveLength(5);
    expect(doc.paths['/api/dashboard']?.post).toBeUndefined();
  });
});
