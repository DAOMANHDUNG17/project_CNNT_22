import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { JwtVerifierService } from '../src/auth/jwt-verifier.service';

const id = '550e8400-e29b-41d4-a716-446655440000';
const actor = { user_id: '42', auth_user_id: '11111111-1111-4111-8111-111111111111', username: 'staff', display_name: 'Staff', role: 'STAFF', is_active: true };
const payload = { transaction_id: id, scan_code: 'SW-SP013-BOX24', scan_point_id: 'SCAN-01', movement_type: 'IN' };

describe('POST /api/stock-movements (e2e with transactional database fake)', () => {
  let app: INestApplication<App>;
  let stock: string;
  let history: Map<string, Record<string, unknown>>;
  let factor: number;
  let productActive: boolean;
  let pointActive: boolean;
  let inventoryMissing: boolean;
  let insertFailure: boolean;
  let updateFailure: boolean;
  let unitCode: string;
  let pointMissing: boolean;
  let query: jest.Mock;
  let transaction: jest.Mock;
  let verify: jest.Mock;
  let role: string;
  let userId: string;

  beforeEach(async () => {
    stock = '100'; history = new Map(); factor = 24; productActive = true;
    pointActive = true; pointMissing = false; inventoryMissing = false;
    insertFailure = false; updateFailure = false; unitCode = payload.scan_code; role = 'STAFF'; userId = '42';
    verify = jest.fn().mockResolvedValue(actor.auth_user_id);
    query = jest.fn(async (sql: string, args: unknown[] = []) => {
      if (sql.startsWith('SELECT pg_advisory_xact_lock')) return [{}];
      if (sql.includes('FROM public.users') && !sql.includes('FOR SHARE')) return [{ ...actor, user_id: userId, role }];
      if (sql.startsWith('SELECT t.transaction_id')) {
        const row = history.get(String(args[0]));
        return row ? [{ ...row, product_name: 'Bút mực', unit_name: 'Hộp' }] : [];
      }
      if (sql.startsWith('SELECT product_id, product_unit_id FROM public.product_units')) {
        return args[0] === unitCode ? [{ product_id: 'SP013', product_unit_id: '29' }] : [];
      }
      if (sql.includes('FROM public.products') && sql.includes('FOR UPDATE')) return [{ product_id: 'SP013', product_name: 'Bút mực', is_active: productActive }];
      if (sql.includes('FROM public.inventory') && sql.includes('FOR UPDATE')) return inventoryMissing ? [] : [{ quantity_base: stock }];
      if (sql.includes('FROM public.product_units') && sql.includes('FOR UPDATE')) return [{ product_id: 'SP013', product_unit_id: '29', unit_name: 'Hộp', scan_code: unitCode, conversion_factor: factor }];
      if (sql.includes('FROM public.scan_points')) return pointMissing ? [] : [{ is_active: pointActive }];
      if (sql.includes('FROM public.users') && sql.includes('FOR SHARE')) return [{ role, is_active: true }];
      if (sql.startsWith('UPDATE public.inventory')) {
        if (updateFailure) throw new Error('private database error');
        stock = String(args[1]);
        return [{ quantity_base: stock }];
      }
      if (sql.startsWith('INSERT INTO public.stock_transactions')) {
        if (insertFailure) throw new Error('private database error');
        if (history.has(String(args[0]))) throw { code: '23505' };
        const row = {
          transaction_id: args[0], product_id: args[1], product_unit_id: args[2], scan_point_id: args[3],
          user_id: args[4], movement_type: args[5], quantity_packages: 1, conversion_factor_snapshot: args[6],
          inventory_before: args[7], inventory_after: args[8], scan_code_snapshot: args[9], quantity_base: String(args[6]),
          created_at: new Date('2026-01-01T00:00:00Z'),
        };
        history.set(String(args[0]), row);
        return [row];
      }
      throw new Error(`Unexpected SQL in test: ${sql.slice(0, 30)}`);
    });
    transaction = jest.fn(async (work: (execute: typeof query) => Promise<unknown>) => {
      const priorStock = stock;
      const priorHistory = new Map(history);
      try { return await work(query); }
      catch (error) { stock = priorStock; history = priorHistory; throw error; }
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService).useValue({ query, transaction, checkHealth: jest.fn() })
      .overrideProvider(JwtVerifierService).useValue({ verify }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterEach(async () => { await app.close(); });

  const post = (app: INestApplication<App>, body: object = payload) => request(app.getHttpServer()).post('/api/stock-movements').set('Authorization', 'Bearer valid-token').send(body);

  it('documents the one IN endpoint, bearer auth, request and retry response', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
    const operation = document.paths['/api/stock-movements']?.post;
    expect(operation?.security).toEqual([{ bearer: [] }]);
    expect(operation?.requestBody).toBeDefined();
    for (const status of [200, 201, 400, 401, 403, 404, 409, 500]) {
      expect(operation?.responses?.[status]).toBeDefined();
    }
    expect(document.paths['/api/stock-movements']?.get).toBeUndefined();
  });

  it('requires JWT and ADMIN/STAFF while rejecting VIEWER/inactive users', async () => {
    await request(app.getHttpServer()).post('/api/stock-movements').send(payload).expect(401);
    role = 'VIEWER'; await post(app).expect(403);
    role = 'ADMIN'; await post(app).expect(201);
    const second = { ...payload, transaction_id: '550e8400-e29b-41d4-a716-446655440001' };
    await post(app, second).expect(201);
    query.mockImplementationOnce(async () => [{ ...actor, is_active: false }]);
    await post(app, { ...payload, transaction_id: '550e8400-e29b-41d4-a716-446655440002' }).expect(403);
    expect(stock).toBe('148');
  });

  it.each([
    {}, { ...payload, transaction_id: 'bad' }, { ...payload, scan_code: ' ' },
    { ...payload, scan_point_id: undefined }, { ...payload, movement_type: 'OUT' },
    { ...payload, user_id: '42' }, { ...payload, quantity_base: '24' },
  ])('rejects invalid input without writing: %p', async body => {
    await post(app, body).expect(400);
    expect(stock).toBe('100'); expect(history.size).toBe(0);
  });

  it('uses the database factor and stores snapshots, before and after', async () => {
    factor = 1;
    const one = await post(app).expect(201);
    expect(one.body.data).toMatchObject({ quantity_packages: 1, quantity_base: '1', inventory_before: '100', inventory_after: '101', conversion_factor_snapshot: 1, scan_code_snapshot: payload.scan_code, user_id: '42' });
    factor = 24;
    const two = await post(app, { ...payload, transaction_id: '550e8400-e29b-41d4-a716-446655440001' }).expect(201);
    expect(two.body.data).toMatchObject({ quantity_base: '24', inventory_before: '101', inventory_after: '125' });
    expect(stock).toBe('125'); expect(history.size).toBe(2);
    const calls = query.mock.calls.map(([sql]) => String(sql));
    expect(calls.findIndex(sql => sql.includes('pg_advisory_xact_lock'))).toBeLessThan(calls.findIndex(sql => sql.includes('FROM public.products') && sql.includes('FOR UPDATE')));
    expect(calls.findIndex(sql => sql.includes('FROM public.products') && sql.includes('FOR UPDATE'))).toBeLessThan(calls.findIndex(sql => sql.includes('FROM public.inventory') && sql.includes('FOR UPDATE')));
    expect(calls.findIndex(sql => sql.includes('FROM public.inventory') && sql.includes('FOR UPDATE'))).toBeLessThan(calls.findIndex(sql => sql.includes('FROM public.product_units') && sql.includes('FOR UPDATE')));
    expect(query.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE public.products') || String(sql).startsWith('UPDATE public.product_units'))).toHaveLength(0);
  });

  it('returns 200 from history on same UUID even after code rename/inactivation', async () => {
    await post(app).expect(201);
    unitCode = 'NEW-CODE'; productActive = false; pointActive = false;
    const replay = await post(app).expect(200);
    expect(replay.body.data).toMatchObject({ scan_code_snapshot: payload.scan_code, inventory_after: '124' });
    expect(stock).toBe('124'); expect(history.size).toBe(1);
  });

  it.each([
    { scan_code: 'OTHER' }, { scan_point_id: 'SCAN-02' },
  ])('rejects UUID reuse with changed business identity: %p', async changed => {
    await post(app).expect(201);
    await post(app, { ...payload, ...changed }).expect(409);
    expect(stock).toBe('124'); expect(history.size).toBe(1);
  });

  it('rejects UUID reuse by another authenticated user', async () => {
    await post(app).expect(201);
    userId = '43';
    await post(app).expect(409);
    expect(stock).toBe('124'); expect(history.size).toBe(1);
  });

  it('rejects missing/inactive references and missing inventory safely', async () => {
    unitCode = 'OTHER'; await post(app).expect(404); unitCode = payload.scan_code;
    pointMissing = true; await post(app).expect(404); pointMissing = false;
    pointActive = false; await post(app).expect(409); pointActive = true;
    productActive = false; await post(app).expect(409); productActive = true;
    inventoryMissing = true; await post(app).expect(409);
    expect(stock).toBe('100'); expect(history.size).toBe(0);
  });

  it('rolls back inventory if history insert fails, and writes no history if update fails', async () => {
    insertFailure = true; await post(app).expect(500);
    expect(stock).toBe('100'); expect(history.size).toBe(0);
    insertFailure = false; updateFailure = true; await post(app).expect(500);
    expect(stock).toBe('100'); expect(history.size).toBe(0);
  });

  it('rejects BIGINT overflow without writes', async () => {
    stock = '9223372036854775800';
    await post(app).expect(409);
    expect(stock).toBe('9223372036854775800'); expect(history.size).toBe(0);
  });
});
