import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { JwtVerifierService } from '../src/auth/jwt-verifier.service';
import { SupabaseAdminService } from '../src/users/supabase-admin.service';

describe('Users ADMIN HTTP contract (isolated doubles)', () => {
  let app: INestApplication<App>;
  let role = 'ADMIN';
  const query = jest.fn();
  const verify = jest.fn();
  const create = jest.fn();
  const remove = jest.fn();
  const authId = '10000000-0000-4000-8000-000000000002';
  const body = { username: 'new.staff', display_name: 'New Staff', email: 'staff@example.test', password: 'qa-Password-12345', role: 'STAFF' };
  const row = { user_id: '9007199254740993', auth_user_id: authId, ...body, password: undefined, is_active: true, created_at: new Date(), updated_at: new Date() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService).useValue({ query, transaction: (fn: (execute: typeof query) => unknown) => fn(query) })
      .overrideProvider(JwtVerifierService).useValue({ verify })
      .overrideProvider(SupabaseAdminService).useValue({ create, remove }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(() => {
    role = 'ADMIN';
    verify.mockReset().mockResolvedValue('10000000-0000-4000-8000-000000000001');
    create.mockReset().mockResolvedValue(authId); remove.mockReset().mockResolvedValue(undefined);
    query.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes('WHERE auth_user_id') || sql.includes('FOR UPDATE') && sql.includes('auth_user_id')) return [{ user_id: '1', auth_user_id: '10000000-0000-4000-8000-000000000001', role, is_active: true }];
      if (sql.includes('username_exists')) return [{ username_exists: false, email_exists: false }];
      if (sql.includes('INSERT')) return [row];
      if (sql.includes('WITH filtered')) return [{ ...row, total: '1' }];
      return [];
    });
  });
  afterAll(async () => { await app.close(); });
  const call = (method: 'get' | 'post' | 'patch', path = '/api/users') => request(app.getHttpServer())[method](path).set('Authorization', 'Bearer fixture-token');

  it('requires JWT for each admin action', async () => {
    await request(app.getHttpServer()).get('/api/users').expect(401);
    await request(app.getHttpServer()).post('/api/users').send(body).expect(401);
    await request(app.getHttpServer()).patch('/api/users/2').send({ role: 'ADMIN' }).expect(401);
  });
  it.each(['STAFF', 'VIEWER'])('denies %s manual admin requests while scan-points GET remains available', async value => {
    role = value;
    await call('get').expect(403); await call('post').send(body).expect(403); await call('patch', '/api/users/2').send({ role: 'ADMIN' }).expect(403);
    await call('get', '/api/scan-points').expect(200);
    expect(create).not.toHaveBeenCalled();
  });
  it('lists real DB columns with SQL pagination and combined filters', async () => {
    const response = await call('get', '/api/users?page=2&limit=10&q=staff&role=STAFF&isActive=false').expect(200);
    expect(response.body.data[0].user_id).toBe('9007199254740993');
    expect(response.body.data[0]).not.toHaveProperty('password');
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('LEFT JOIN auth.users'), ['staff', 'STAFF', false, 10, '10']);
  });
  it('links Auth UUID, returns no password and preserves requested role', async () => {
    const response = await call('post').send(body).expect(201);
    expect(response.body.data.auth_user_id).toBe(authId);
    expect(response.body.data.role).toBe('STAFF'); expect(response.body.data).not.toHaveProperty('password');
    expect(create).toHaveBeenCalledWith(body.email, body.password);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO public.users'), [authId, body.username, body.display_name, 'STAFF', true]);
  });
  it.each([{ email: 'bad' }, { role: 'KEEPER' }, { password: 'short' }, { username: ' ' }, { is_active: 'true' }, { auth_user_id: authId }, { user_id: '3' }])('rejects invalid create input %j', async patch => {
    await call('post').send({ ...body, ...patch }).expect(400); expect(create).not.toHaveBeenCalled();
  });
  it.each([{ role: null }, { is_active: null }, { role: 'service_role' }, { email: 'change@example.test' }, { password: 'new-password-123' }, {}])('rejects unsupported patch %j', async patch => {
    await call('patch', '/api/users/2').send(patch).expect(400);
  });
  it('rejects duplicate email before provisioning Auth', async () => {
    query.mockImplementation(async (sql: string) => sql.includes('username_exists') ? [{ email_exists: true }] : [{ role: 'ADMIN', is_active: true }]);
    await call('post').send(body).expect(409); expect(create).not.toHaveBeenCalled();
  });
  it('does not write DB profile if Auth fails', async () => {
    create.mockRejectedValue(new Error('private secret'));
    await call('post').send(body).expect(500);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT'))).toBe(false);
  });
  it('compensates Auth if profile insert fails', async () => {
    const implementation = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, ...rest: unknown[]) => { if (sql.includes('INSERT')) throw new Error('private SQL'); return implementation(sql, ...rest); });
    await call('post').send(body).expect(500); expect(remove).toHaveBeenCalledWith(authId);
  });
  it('retains committed Auth/profile if COMMIT acknowledgement is lost', async () => {
    const database = app.get(DatabaseService);
    const implementation = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, ...rest: unknown[]) => sql.includes('WHERE u.auth_user_id') ? [row] : implementation(sql, ...rest));
    const transaction = jest.spyOn(database, 'transaction').mockImplementationOnce(async fn => { await fn(query); throw new Error('lost commit'); });
    await call('post').send(body).expect(201); expect(remove).not.toHaveBeenCalled();
    transaction.mockRestore();
  });
  it('reports unresolved compensation and never returns success', async () => {
    const implementation = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, ...rest: unknown[]) => { if (sql.includes('INSERT')) throw new Error('DB unavailable'); return implementation(sql, ...rest); });
    remove.mockRejectedValueOnce(new Error('Auth delete unavailable'));
    await call('post').send(body).expect(500);
    expect(remove).toHaveBeenCalledWith(authId);
  });
  it('preserves Auth when commit outcome cannot be determined', async () => {
    const implementation = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, ...rest: unknown[]) => {
      if (sql.includes('INSERT') || sql.includes('WHERE u.auth_user_id')) throw new Error('connection lost');
      return implementation(sql, ...rest);
    });
    await call('post').send(body).expect(503); expect(remove).not.toHaveBeenCalled();
  });
  it('rechecks actor role after guard and before any write', async () => {
    const implementation = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, ...rest: unknown[]) => sql.includes('FOR UPDATE') ? [{ role: 'STAFF', is_active: true }] : implementation(sql, ...rest));
    await call('post').send(body).expect(403); expect(create).not.toHaveBeenCalled();
  });
});
