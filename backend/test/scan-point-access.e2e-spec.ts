import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { JwtVerifierService } from '../src/auth/jwt-verifier.service';

describe('Scan point access HTTP validation and RBAC', () => {
  let app: INestApplication<App>;
  let role = 'ADMIN'; let active = true;
  const query = jest.fn();
  const actor = { user_id: '9007199254740993', auth_user_id: '10000000-0000-4000-8000-000000000001', username: 'admin', display_name: 'Admin' };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService).useValue({ query, transaction: (fn: (run: typeof query) => unknown) => fn(query) })
      .overrideProvider(JwtVerifierService).useValue({ verify: async () => actor.auth_user_id }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init();
  });
  beforeEach(() => {
    role = 'ADMIN'; active = true;
    query.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes('WHERE auth_user_id') || sql.includes('FOR UPDATE') && sql.includes('auth_user_id')) return [{ ...actor, role, is_active: active }];
      if (sql.includes('SELECT user_id, role FROM public.users')) return [{ user_id: '2', role: 'STAFF' }];
      if (sql.includes('LEFT JOIN public.user_scan_point_access')) return [{ user_id: '2', scan_point_id: null }];
      if (sql.includes('FROM public.scan_points') && sql.includes('FOR SHARE')) return [{ scan_point_id: 'SCAN-01', is_active: true }];
      return [];
    });
  });
  afterAll(async () => { await app.close(); });
  const get = (path = '/api/users/2/scan-points') => request(app.getHttpServer()).get(path).set('Authorization', 'Bearer fixture');
  const put = (id = '2') => request(app.getHttpServer()).put(`/api/users/${id}/scan-points`).set('Authorization', 'Bearer fixture');
  it('ADMIN reads an empty grant list', async () => { await get().expect(200).expect({ data: [], count: 0 }); });
  it('ADMIN writes only backend actor ID and parameterized scan IDs', async () => {
    await put().send({ scan_point_ids: ['SCAN-01'] }).expect(200);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (user_id, scan_point_id)'), ['2', actor.user_id, 'SCAN-01']);
    const statement = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO public.user_scan_point_access'))![0];
    expect(statement).not.toContain('SCAN-01');
  });
  it.each(['STAFF', 'VIEWER'])('rejects %s administration', async value => {
    role = value; await get().expect(403); await put().send({ scan_point_ids: [] }).expect(403);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE public.user_scan_point_access'))).toBe(false);
  });
  it('requires JWT and rejects locked accounts', async () => {
    await request(app.getHttpServer()).get('/api/users/2/scan-points').expect(401);
    await request(app.getHttpServer()).put('/api/users/2/scan-points').send({ scan_point_ids: [] }).expect(401);
    await request(app.getHttpServer()).get('/api/scan-points/my').expect(401);
    active = false; await get('/api/scan-points/my').expect(403);
  });
  it.each([{}, { scan_point_ids: null }, { scan_point_ids: 'SCAN-01' }, { scan_point_ids: [1] }, { scan_point_ids: [''] },
    { scan_point_ids: ['BAD ID'] }, { scan_point_ids: ['X'.repeat(21)] }, { scan_point_ids: ['SCAN-01', 'SCAN-01'] },
    { scan_point_ids: Array.from({ length: 101 }, (_, i) => `P${i}`) }, { scan_point_ids: [], assigned_by: '1' }])('rejects invalid body %j', async body => {
    await put().send(body).expect(400);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE public.user_scan_point_access'))).toBe(false);
  });
  it.each(['0', '-1', 'bad', '9223372036854775808'])('rejects invalid user ID %s', async id => {
    await put(id).send({ scan_point_ids: [] }).expect(400); await get(`/api/users/${id}/scan-points`).expect(400);
  });
  it('returns 404 for missing user and missing scan point', async () => {
    const implementation = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, ...params: unknown[]) => sql.includes('LEFT JOIN public.user_scan_point_access') || sql.includes('SELECT user_id, role FROM public.users') ? [] : implementation(sql, ...params));
    await get().expect(404); await put().send({ scan_point_ids: [] }).expect(404);
    query.mockImplementation(async (sql: string, ...params: unknown[]) => sql.includes('FOR SHARE') ? [] : implementation(sql, ...params));
    await put().send({ scan_point_ids: ['MISSING'] }).expect(404);
  });
  it('does not write when selected point is inactive', async () => {
    const implementation = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, ...params: unknown[]) => sql.includes('FOR SHARE') ? [{ scan_point_id: 'SCAN-01', is_active: false }] : implementation(sql, ...params));
    await put().send({ scan_point_ids: ['SCAN-01'] }).expect(400);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE public.user_scan_point_access'))).toBe(false);
  });
  it('my endpoint uses current ID and auth UUID and rejects client ID overrides', async () => {
    await get('/api/scan-points/my').expect(200).expect({ data: [], count: 0 });
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("u.role IN ('ADMIN', 'STAFF')"), [actor.user_id, actor.auth_user_id]);
    await get('/api/scan-points/my?user_id=2').expect(400);
  });
  it('returns safe failure when database fails', async () => {
    const implementation = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, ...params: unknown[]) => { if (sql.includes('user_scan_point_access')) throw new Error('private connection details'); return implementation(sql, ...params); });
    await get().expect(503); await put().send({ scan_point_ids: [] }).expect(503);
    await get('/api/scan-points/my').expect(503);
  });
});
