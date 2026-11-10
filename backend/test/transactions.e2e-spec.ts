import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { JwtVerifierService } from '../src/auth/jwt-verifier.service';

describe('GET /api/transactions HTTP contract (mock database)', () => {
  let app: INestApplication<App>;
  const query = jest.fn();
  const verify = jest.fn();
  let role = 'ADMIN';
  const row = {
    transaction_id: 'f3a754fd-df1d-4d7f-8220-411f07415070', product_id: 'SP013', product_name: 'Current product',
    product_unit_id: '9007199254740993', unit_name: 'Current unit', movement_type: 'IN', quantity_packages: 1,
    conversion_factor_snapshot: 24, quantity_base: '24', inventory_before: '9007199254740993',
    inventory_after: '9007199254741017', scan_code_snapshot: 'OLD-CODE', scan_point_id: 'SCAN-01',
    point_name: 'Gate', user_id: '9007199254740994', display_name: 'Operator',
    created_at: new Date('2026-11-10T22:03:59Z'), total: '2',
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
  beforeEach(() => {
    role = 'ADMIN';
    verify.mockReset().mockResolvedValue('00000000-0000-4000-8000-000000000001');
    query.mockReset().mockImplementation(async (sql: string) => sql.includes('WHERE auth_user_id') ? [{
      user_id: '1', auth_user_id: '00000000-0000-4000-8000-000000000001', username: 'qa',
      display_name: 'QA', role, is_active: true,
    }] : [row]);
  });
  afterAll(async () => { await app.close(); });
  const get = (suffix = '') => request(app.getHttpServer()).get(`/api/transactions${suffix}`).set('Authorization', 'Bearer fixture-token');

  it.each(['ADMIN', 'STAFF', 'VIEWER'])('allows %s and serializes historical BIGINT snapshots', async value => {
    role = value;
    const response = await get().expect(200);
    expect(response.body).toMatchObject({ count: 2, pagination: { page: 1, limit: 20, total: 2, totalPages: 1 } });
    expect(response.body.data[0]).toMatchObject({ product_unit_id: row.product_unit_id, user_id: row.user_id,
      quantity_base: '24', inventory_before: row.inventory_before, inventory_after: row.inventory_after,
      conversion_factor_snapshot: 24, scan_code_snapshot: 'OLD-CODE' });
    expect(response.body.data[0]).not.toHaveProperty('total');
    expect(response.body.data[0]).not.toHaveProperty('auth_user_id');
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('ORDER BY created_at DESC, transaction_id DESC'), [20, '0']);
  });

  it('requires valid authentication and permitted active business role', async () => {
    await request(app.getHttpServer()).get('/api/transactions').expect(401);
    verify.mockRejectedValueOnce(new Error('invalid JWT'));
    await get().expect(401);
    role = 'UNSUPPORTED'; await get().expect(403);
    query.mockResolvedValueOnce([{ role: 'ADMIN', is_active: false }]);
    await get().expect(403);
  });

  it.each([
    'page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=', 'page=1&page=2', 'page=9007199254740992',
    'limit=0', 'limit=101', 'limit=2.5', 'limit=false', 'transactionId=bad', 'transactionId=',
    'productId=', 'productId=%20', `productId=${'X'.repeat(21)}`, 'movementType=MOVE',
    'scanPointId=', `scanPointId=${'X'.repeat(21)}`, 'from=2026-11-10', 'from=2026-11-10T00:00:00',
    'from=2026-02-30T00:00:00Z', 'to=bad', 'unknown=true',
    'from=2026-11-11T00:00:00Z&to=2026-11-10T00:00:00Z',
    'from=2026-11-10T00:00:00Z&to=2026-11-10T00:00:00Z',
  ])('rejects invalid query %s without history SQL', async suffix => {
    await get(`?${suffix}`).expect(400);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes('public.stock_transactions'))).toHaveLength(0);
  });

  it('parameterizes all filters, supports microseconds and uses one SELECT for count/page', async () => {
    await get(`?page=2&limit=1&transactionId=${row.transaction_id}&productId=%20SP013%20&movementType=OUT&scanPointId=SCAN-01&from=2026-11-10T00:00:00.000001Z&to=2026-11-10T00:00:00.000002Z`).expect(200);
    const [statement, values] = query.mock.calls[1];
    expect(values).toEqual([row.transaction_id, 'SP013', 'OUT', 'SCAN-01', '2026-11-10T00:00:00.000001Z', '2026-11-10T00:00:00.000002Z', 1, '1']);
    expect(statement).toContain('t.created_at >= $5::timestamptz');
    expect(statement).toContain('t.created_at < $6::timestamptz');
    expect(statement).not.toContain(row.transaction_id);
    expect(statement).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(statement).not.toContain('auth.users');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('returns an empty page with the filtered total intact', async () => {
    query.mockImplementation(async (sql: string) => sql.includes('WHERE auth_user_id') ? [{ role: 'VIEWER', is_active: true }] : [{ total: '0', transaction_id: null }]);
    await get(`?transactionId=${row.transaction_id}`).expect(200).expect({ data: [], count: 0, pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  });

  it('hides unexpected database details', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('WHERE auth_user_id')) return [{ role: 'ADMIN', is_active: true }];
      throw new Error('password=private SQL stack');
    });
    const response = await get().expect(500);
    expect(JSON.stringify(response.body)).not.toMatch(/private|password|SQL stack/);
  });

  it('documents only one GET with every query and error status', () => {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
    const operation = doc.paths['/api/transactions']?.get;
    expect(operation?.security).toEqual([{ bearer: [] }]);
    expect(operation?.parameters).toHaveLength(8);
    for (const status of [200, 400, 401, 403, 500]) expect(operation?.responses[status]).toBeDefined();
    expect(doc.paths['/api/transactions/{id}']).toBeUndefined();
    expect(doc.paths['/api/transactions']?.post).toBeUndefined();
  });
});
