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
  let userActive: boolean;
  let assignedIds: string[];

  beforeEach(async () => {
    stock = '100'; history = new Map(); factor = 24; productActive = true;
    pointActive = true; pointMissing = false; inventoryMissing = false;
    insertFailure = false; updateFailure = false; unitCode = payload.scan_code; role = 'STAFF'; userId = '42';
    assignedIds = ['SCAN-01']; userActive = true;
    verify = jest.fn().mockResolvedValue(actor.auth_user_id);
    query = jest.fn(async (sql: string, args: unknown[] = []) => {
      if (sql.startsWith('SELECT pg_advisory_xact_lock')) return [{}];
      if (sql.includes('FROM public.user_scan_point_access')) return assignedIds.map(scan_point_id => ({ scan_point_id }));
      if (sql.includes('FROM public.users') && !sql.includes('FOR SHARE')) return [{ ...actor, user_id: userId, role, is_active: userActive }];
      if (sql.startsWith('SELECT t.transaction_id')) {
        const row = history.get(String(args[0]).toLowerCase());
        return row ? [{ ...row, product_name: 'Bút mực', unit_name: 'Hộp' }] : [];
      }
      if (sql.startsWith('SELECT product_id, product_unit_id FROM public.product_units')) {
        return args[0] === unitCode ? [{ product_id: 'SP013', product_unit_id: '29' }] : [];
      }
      if (sql.includes('FROM public.products') && sql.includes('FOR UPDATE')) return [{ product_id: 'SP013', product_name: 'Bút mực', is_active: productActive }];
      if (sql.includes('FROM public.inventory') && sql.includes('FOR UPDATE')) return inventoryMissing ? [] : [{ quantity_base: stock }];
      if (sql.includes('FROM public.product_units') && sql.includes('FOR UPDATE')) return [{ product_id: 'SP013', product_unit_id: '29', unit_name: 'Hộp', scan_code: unitCode, conversion_factor: factor }];
      if (sql.includes('FROM public.scan_points')) return pointMissing ? [] : [{ is_active: pointActive }];
      if (sql.includes('FROM public.users') && sql.includes('FOR SHARE')) return [{ role, is_active: userActive }];
      if (sql.startsWith('UPDATE public.inventory')) {
        if (updateFailure) throw new Error('private database error');
        stock = String(args[1]);
        return [{ quantity_base: stock }];
      }
      if (sql.startsWith('INSERT INTO public.stock_transactions')) {
        if (insertFailure) throw new Error('private database error');
        const transactionId = String(args[0]).toLowerCase();
        if (history.has(transactionId)) throw { code: '23505' };
        const row = {
          transaction_id: transactionId, product_id: args[1], product_unit_id: args[2], scan_point_id: args[3],
          user_id: args[4], movement_type: args[5], quantity_packages: args[6], conversion_factor_snapshot: args[7],
          inventory_before: args[8], inventory_after: args[9], scan_code_snapshot: args[10], quantity_base: String(BigInt(String(args[6])) * BigInt(String(args[7]))),
          created_at: new Date('2026-01-01T00:00:00Z'),
        };
        history.set(transactionId, row);
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

  it('documents the movement endpoint, bearer auth, request and KT2 response schemas', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
    const operation = document.paths['/api/stock-movements']?.post;
    expect(operation?.security).toEqual([{ bearer: [] }]);
    expect(operation?.requestBody).toBeDefined();
    expect(document.components?.schemas?.CreateStockMovementDto).toMatchObject({ properties: { movement_type: { enum: ['IN', 'OUT'] } } });
    expect(operation?.responses?.[201]).toHaveProperty(
      ['content', 'application/json', 'schema', 'properties', 'data', 'properties', 'movement_type', 'enum'], ['IN', 'OUT'],
    );
    for (const [status, isDuplicate] of [[201, false], [200, true]] as const) {
      expect(operation?.responses?.[status]).toHaveProperty(
        ['content', 'application/json', 'schema'],
        expect.objectContaining({
          required: ['message', 'is_duplicate', 'data'],
          properties: expect.objectContaining({
            message: expect.objectContaining({ type: 'string', example: expect.any(String) }),
            is_duplicate: { type: 'boolean', enum: [isDuplicate], example: isDuplicate },
          }),
        }),
      );
    }
    expect(operation?.responses?.[409]).toHaveProperty(
      ['content', 'application/json', 'schema', 'properties', 'message', 'example'],
      'Mã giao dịch đã được dùng cho một lượt nhập/xuất khác.',
    );
    for (const status of [200, 201, 400, 401, 403, 404, 409, 500]) {
      expect(operation?.responses?.[status]).toBeDefined();
    }
    expect(document.paths['/api/stock-movements']?.get).toBeUndefined();
    const replay = document.paths['/api/stock-movements/replay']?.post;
    expect(replay?.security).toEqual([{ bearer: [] }]);
    expect(replay?.responses?.[200]).toHaveProperty(
      ['content', 'application/json', 'schema', 'properties', 'is_duplicate', 'enum'], [true],
    );
    expect(replay?.responses?.[404]).toBeDefined();
    expect(replay?.responses?.[201]).toBeUndefined();
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
    { ...payload, scan_point_id: null }, { ...payload, movement_type: 'MOVE' },
    { ...payload, user_id: '42' }, { ...payload, quantity_base: '24' },
    { ...payload, quantity_packages: 0 }, { ...payload, quantity_packages: -1 },
    { ...payload, quantity_packages: 1.5 }, { ...payload, quantity_packages: '2' },
    { ...payload, quantity_packages: null }, { ...payload, quantity_packages: 2147483648 },
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

  it('exports one database-defined package for factors 1 and 24, including exact depletion', async () => {
    factor = 1;
    const one = await post(app, { ...payload, movement_type: 'OUT' }).expect(201);
    expect(one.body.data).toMatchObject({ movement_type: 'OUT', quantity_packages: 1, conversion_factor_snapshot: 1, quantity_base: '1', inventory_before: '100', inventory_after: '99' });
    stock = '24'; factor = 24;
    const two = await post(app, { ...payload, transaction_id: '550e8400-e29b-41d4-a716-446655440001', movement_type: 'OUT' }).expect(201);
    expect(two.body.data).toMatchObject({ quantity_base: '24', inventory_before: '24', inventory_after: '0' });
    expect(stock).toBe('0'); expect(history.size).toBe(2);
  });

  it('KT1 records a valid multi-package IN/OUT pair with exact identities, snapshots and restored stock', async () => {
    const incoming = { ...payload, quantity_packages: 3 };
    const outgoing = { ...incoming, transaction_id: '550e8400-e29b-41d4-a716-446655440001', movement_type: 'OUT' };
    const identity = { product_id: 'SP013', product_unit_id: '29', user_id: '42',
      scan_point_id: 'SCAN-01', scan_code_snapshot: payload.scan_code,
      quantity_packages: 3, conversion_factor_snapshot: 24, quantity_base: '72' };

    const createdIn = await post(app, incoming).expect(201);
    expect(createdIn.body.data).toMatchObject({ ...identity, transaction_id: incoming.transaction_id,
      movement_type: 'IN', inventory_before: '100', inventory_after: '172' });
    expect(stock).toBe('172');
    expect(history.get(incoming.transaction_id)).toMatchObject({ ...identity, transaction_id: incoming.transaction_id,
      movement_type: 'IN', inventory_before: '100', inventory_after: '172' });

    const createdOut = await post(app, outgoing).expect(201);
    expect(createdOut.body.data).toMatchObject({ ...identity, transaction_id: outgoing.transaction_id,
      movement_type: 'OUT', inventory_before: '172', inventory_after: '100' });
    expect(stock).toBe('100');
    expect(history.size).toBe(2);
    expect(history.get(outgoing.transaction_id)).toMatchObject({ ...identity, transaction_id: outgoing.transaction_id,
      movement_type: 'OUT', inventory_before: '172', inventory_after: '100' });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('KT2 uses the same lock identity for uppercase and lowercase forms of one UUID', async () => {
    const lowerId = 'abcdefab-1234-4abc-8def-1234567890ab';
    const body = { ...payload, transaction_id: lowerId };
    await post(app, body).expect(201);
    const replay = await post(app, { ...body, transaction_id: lowerId.toUpperCase() }).expect(200);
    expect(replay.body.data.transaction_id).toBe(lowerId);
    expect(stock).toBe('124'); expect(history.size).toBe(1);
    const lockIds = query.mock.calls.filter(([sql]) => String(sql).startsWith('SELECT pg_advisory_xact_lock')).map(([, args]) => args[0]);
    expect(lockIds).toEqual([lowerId, lowerId]);
  });

  it('KT2 exact replay returns the original snapshot without inventory or history DML', async () => {
    const body = { ...payload, quantity_packages: 3 };
    const created = await post(app, body).expect(201);
    expect(created.body).toMatchObject({ message: 'Giao dịch được tạo thành công.', is_duplicate: false });
    const saved = structuredClone(history.get(id));
    query.mockClear();
    const replay = await post(app, body).expect(200);
    expect(replay.body).toEqual({
      message: 'Giao dịch đã được xử lý trước đó. Hệ thống không ghi trùng và không cập nhật tồn kho lần nữa.',
      is_duplicate: true,
      data: created.body.data,
    });
    expect(stock).toBe('172'); expect(history.size).toBe(1);
    expect(history.get(id)).toEqual(saved);
    expect(query.mock.calls.filter(([sql]) => /^(UPDATE|INSERT|DELETE|TRUNCATE)\b/iu.test(String(sql)))).toHaveLength(0);
  });

  it('KT2 treats distinct UUIDs with the same payload as separate movements', async () => {
    const first = await post(app).expect(201);
    const secondId = '550e8400-e29b-41d4-a716-446655440001';
    const second = await post(app, { ...payload, transaction_id: secondId }).expect(201);
    expect(first.body.data.transaction_id).toBe(id);
    expect(second.body.data.transaction_id).toBe(secondId);
    expect(stock).toBe('148'); expect(history.size).toBe(2);
  });

  const replayOnly = (app: INestApplication<App>, body: object = payload) =>
    request(app.getHttpServer()).post('/api/stock-movements/replay').set('Authorization', 'Bearer valid-token').send(body);

  it('replays existing UUIDs only and preserves data through replay, conflict and access checks', async () => {
    const created = await post(app).expect(201);
    const saved = structuredClone(history.get(id));
    query.mockClear();

    const replay = await replayOnly(app).expect(200);
    expect(replay.body).toMatchObject({ is_duplicate: true, data: created.body.data });
    const conflict = await replayOnly(app, { ...payload, quantity_packages: 2 }).expect(409);
    expect(conflict.body.message).toBe('Mã giao dịch đã được dùng cho một lượt nhập/xuất khác.');
    userId = '43';
    await replayOnly(app).expect(409);
    assignedIds = ['SCAN-02'];
    await replayOnly(app).expect(403);
    role = 'ADMIN';
    await replayOnly(app).expect(403);
    await request(app.getHttpServer()).post('/api/stock-movements/replay').send(payload).expect(401);

    expect(stock).toBe('124');
    expect(history.size).toBe(1);
    expect(history.get(id)).toEqual(saved);
    expect(query.mock.calls.some(([sql]) => /^(UPDATE|INSERT|DELETE)\b/iu.test(String(sql)))).toBe(false);
  });

  it('returns 404 for unknown UUIDs on the replay-only route without accessing the write path', async () => {
    const response = await replayOnly(app).expect(404);
    expect(response.body.message).toBe('Không tìm thấy giao dịch với UUID này.');
    expect(stock).toBe('100');
    expect(history.size).toBe(0);
    expect(query.mock.calls.some(([sql]) => /^(UPDATE|INSERT)|FROM public\.product_units/u.test(String(sql)))).toBe(false);
  });

  it.each(['product_id', 'product_unit_id'])('KT2 rejects changing %s directly on an existing UUID', async field => {
    await post(app).expect(201);
    query.mockClear();
    await post(app, { ...payload, [field]: 'OTHER' }).expect(400);
    expect(stock).toBe('124'); expect(history.size).toBe(1);
    expect(query.mock.calls.filter(([sql]) => /^(UPDATE|INSERT)\b/iu.test(String(sql)))).toHaveLength(0);
  });

  it.each([
    { quantity_packages: 2 }, { movement_type: 'OUT' },
    { scan_code: 'OTHER-UNIT-CODE' }, { scan_code: 'OTHER-PRODUCT-CODE' },
  ])('KT2 conflicting replay does not write or expose the original movement: %p', async changed => {
    await post(app).expect(201);
    const saved = structuredClone(history.get(id));
    query.mockClear();
    const response = await post(app, { ...payload, ...changed }).expect(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: 'Mã giao dịch đã được dùng cho một lượt nhập/xuất khác.',
    });
    expect(response.body.data).toBeUndefined();
    expect(stock).toBe('124'); expect(history.size).toBe(1);
    expect(history.get(id)).toEqual(saved);
    expect(query.mock.calls.filter(([sql]) => /^(UPDATE|INSERT)\b/iu.test(String(sql)))).toHaveLength(0);
  });

  it.each(['missing-token', 'invalid-token', 'viewer', 'inactive'])('KT2 applies authentication and role checks before replay: %s', async variant => {
    await post(app).expect(201);
    query.mockClear();
    if (variant === 'invalid-token') verify.mockRejectedValueOnce(new Error('invalid JWT'));
    if (variant === 'viewer') role = 'VIEWER';
    if (variant === 'inactive') userActive = false;
    const pendingRequest = variant === 'missing-token'
      ? request(app.getHttpServer()).post('/api/stock-movements').send(payload) : post(app);
    const response = await pendingRequest.expect(variant.endsWith('token') ? 401 : 403);
    expect(response.body.data).toBeUndefined();
    expect(stock).toBe('124'); expect(history.size).toBe(1);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('SELECT t.transaction_id'))).toBe(false);
    expect(query.mock.calls.filter(([sql]) => /^(UPDATE|INSERT)\b/iu.test(String(sql)))).toHaveLength(0);
  });

  it.each(['original', 'revoked', 'other-user'])('KT2 reauthorizes the unique-key fallback: %s', async variant => {
    await post(app).expect(201);
    query.mockClear();
    transaction.mockRejectedValueOnce({ code: '23505' });
    if (variant === 'revoked') assignedIds = [];
    if (variant === 'other-user') userId = '43';
    const response = await post(app).expect(variant === 'original' ? 200 : variant === 'revoked' ? 403 : 409);
    if (variant !== 'original') expect(response.body.data).toBeUndefined();
    expect(stock).toBe('124'); expect(history.size).toBe(1);
    expect(query.mock.calls.filter(([sql]) => /^(UPDATE|INSERT)\b/iu.test(String(sql)))).toHaveLength(0);
    if (variant === 'revoked') expect(query.mock.calls.some(([sql]) => String(sql).startsWith('SELECT t.transaction_id'))).toBe(false);
  });

  it('uses editable package counts for IN and OUT and binds count to UUID replay', async () => {
    const incoming = { ...payload, quantity_packages: 3 };
    const createdIn = await post(app, incoming).expect(201);
    expect(createdIn.body.data).toMatchObject({ quantity_packages: 3, conversion_factor_snapshot: 24, quantity_base: '72', inventory_before: '100', inventory_after: '172' });
    await post(app, incoming).expect(200);
    await post(app, { ...incoming, quantity_packages: 2 }).expect(409);
    const outgoing = { ...payload, transaction_id: '550e8400-e29b-41d4-a716-446655440001', movement_type: 'OUT', quantity_packages: 2 };
    const createdOut = await post(app, outgoing).expect(201);
    expect(createdOut.body.data).toMatchObject({ quantity_packages: 2, quantity_base: '48', inventory_before: '172', inventory_after: '124' });
    await post(app, outgoing).expect(200);
    await post(app, { ...outgoing, quantity_packages: 3 }).expect(409);
    expect(stock).toBe('124'); expect(history.size).toBe(2);
  });

  it('rejects multi-package OUT when stock only covers fewer packages', async () => {
    stock = '48';
    const response = await post(app, { ...payload, movement_type: 'OUT', quantity_packages: 3 }).expect(409);
    expect(response.body.message).toBe('Không đủ tồn kho để xuất.');
    expect(stock).toBe('48'); expect(history.size).toBe(0);
  });

  it('rejects insufficient or zero stock without a write, but replays committed OUT at zero', async () => {
    stock = '24';
    const out = { ...payload, movement_type: 'OUT' };
    await post(app, out).expect(201);
    const count = history.size;
    const replay = await post(app, out).expect(200);
    expect(replay.body.data.inventory_after).toBe('0');
    expect(history.size).toBe(count); expect(stock).toBe('0');
    const insufficient = await post(app, { ...out, transaction_id: '550e8400-e29b-41d4-a716-446655440001' }).expect(409);
    expect(insufficient.body.message).toBe('Không đủ tồn kho để xuất.');
    expect(history.size).toBe(count); expect(stock).toBe('0');
    stock = '23';
    await post(app, { ...out, transaction_id: '550e8400-e29b-41d4-a716-446655440002' }).expect(409);
    expect(history.size).toBe(count); expect(stock).toBe('23');
  });

  it('rejects OUT UUID reuse with changed type, code, point or actor', async () => {
    const out = { ...payload, movement_type: 'OUT' };
    await post(app, out).expect(201);
    for (const changed of [{ movement_type: 'IN' }, { scan_code: 'OTHER' }]) {
      await post(app, { ...out, ...changed }).expect(409);
    }
    await post(app, { ...out, scan_point_id: 'SCAN-02' }).expect(403);
    userId = '43'; await post(app, out).expect(409);
    expect(stock).toBe('76'); expect(history.size).toBe(1);
  });

  it('rolls back OUT inventory when insert fails and leaves history empty when update fails', async () => {
    insertFailure = true; await post(app, { ...payload, movement_type: 'OUT' }).expect(500);
    expect(stock).toBe('100'); expect(history.size).toBe(0);
    insertFailure = false; updateFailure = true;
    await post(app, { ...payload, movement_type: 'OUT' }).expect(500);
    expect(stock).toBe('100'); expect(history.size).toBe(0);
  });

  it('returns 200 from history on same UUID even after code rename/inactivation', async () => {
    await post(app).expect(201);
    unitCode = 'NEW-CODE'; productActive = false;
    const replay = await post(app).expect(200);
    expect(replay.body.data).toMatchObject({ scan_code_snapshot: payload.scan_code, inventory_after: '124' });
    expect(stock).toBe('124'); expect(history.size).toBe(1);
  });

  it.each([
    { scan_code: 'OTHER' }, { scan_point_id: 'SCAN-02' },
  ])('rejects UUID reuse with changed business identity: %p', async changed => {
    await post(app).expect(201);
    await post(app, { ...payload, ...changed }).expect('scan_point_id' in changed ? 403 : 409);
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
    pointMissing = true; await post(app).expect(403); pointMissing = false;
    pointActive = false; await post(app).expect(403); pointActive = true;
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
  it('resolves STAFF point from the database when client omits it and ignores station/IP headers', async () => {
    const { scan_point_id: _point, ...body } = payload;
    const response = await request(app.getHttpServer()).post('/api/stock-movements?station=SCAN-02').set('Authorization', 'Bearer valid-token').set('X-VLAN', '20').send(body).expect(201);
    expect(response.body.data.scan_point_id).toBe('SCAN-01');
  });
  it('rejects missing, ambiguous and revoked assignments including committed UUID retries', async () => {
    assignedIds = []; await post(app).expect(403);
    assignedIds = ['SCAN-01', 'SCAN-02']; await post(app).expect(403);
    assignedIds = ['SCAN-01']; await post(app).expect(201);
    assignedIds = []; await post(app).expect(403);
    assignedIds = ['SCAN-02']; await post(app).expect(403);
    const { scan_point_id: _point, ...body } = payload; await post(app, body).expect(403);
    expect(stock).toBe('124'); expect(history.size).toBe(1);
  });
  it('ADMIN has no implicit assignment bypass', async () => {
    role = 'ADMIN'; assignedIds = []; await post(app).expect(403); expect(stock).toBe('100'); expect(history.size).toBe(0);
  });
});
