import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { UsersService } from '../src/users/users.service';
import { SupabaseAdminService } from '../src/users/supabase-admin.service';
import type { BusinessUser } from '../src/auth/auth.types';

// Opt-in to controlled QA fixtures on the configured project. No Auth, SQL or JWT doubles.
const suite = process.env.QA_ACCESS_SUPABASE_TEST === '1' ? describe : describe.skip;
jest.setTimeout(60000);
suite('Scan access with real Supabase services and STAFF JWT', () => {
  let app: INestApplication<App>; let database: DatabaseService; let users: UsersService;
  let actor: BusinessUser; let baseline: unknown;
  const username = `qa-users-${randomUUID()}`; const email = `${username}@example.com`; const password = `Qa!${randomUUID()}`;
  const snapshot = async () => (await database.query(`SELECT
    (SELECT md5(COALESCE(string_agg(row_to_json(u)::text,'|' ORDER BY user_id),'')) FROM public.users u) AS users,
    (SELECT md5(COALESCE(string_agg(row_to_json(a)::text,'|' ORDER BY user_id,scan_point_id),'')) FROM public.user_scan_point_access a) AS access,
    (SELECT md5(COALESCE(string_agg(row_to_json(s)::text,'|' ORDER BY scan_point_id),'')) FROM public.scan_points s) AS points,
    (SELECT md5(COALESCE(string_agg(row_to_json(i)::text,'|' ORDER BY product_id),'')) FROM public.inventory i) AS inventory,
    (SELECT md5(COALESCE(string_agg(row_to_json(t)::text,'|' ORDER BY transaction_id),'')) FROM public.stock_transactions t) AS history`))[0];
  beforeAll(async () => {
    if (!process.env.QA_ACCESS_ANON_KEY) throw new Error('Supabase publishable key required for QA sign-in');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init();
    database = app.get(DatabaseService); users = app.get(UsersService);
    baseline = await snapshot();
    const actors = await database.query("SELECT user_id::text,auth_user_id,username,display_name,role,is_active FROM public.users WHERE role='ADMIN' AND is_active ORDER BY user_id LIMIT 1");
    if (!actors[0]) throw new Error('An existing active ADMIN is required');
    actor = actors[0] as unknown as BusinessUser;
  });
  afterAll(async () => {
    try {
      if (database) {
        // Derive cleanup identity from the unique fixture email, never from an unchecked HTTP result.
        const rows = await database.query('SELECT a.id,u.user_id::text FROM auth.users a LEFT JOIN public.users u ON u.auth_user_id=a.id AND u.username=$2 WHERE a.email=$1', [email, username]);
        const fixture = rows[0];
        if (fixture?.user_id) await database.transaction(async query => {
          await query('DELETE FROM public.user_scan_point_access WHERE user_id=$1', [fixture.user_id as string]);
          return query('DELETE FROM public.users WHERE user_id=$1 AND username=$2', [fixture.user_id as string, username]);
        });
        if (fixture?.id) await app.get(SupabaseAdminService).remove(fixture.id as string);
        expect(await snapshot()).toEqual(baseline);
      }
    } finally { await app?.close(); }
  });
  it('grants/revokes atomically through real services, filters my by real JWT and leaves existing data intact', async () => {
    const created = await users.create({ username, display_name: 'QA Scan Access', email, password, role: 'STAFF' }, actor);
    const id = created.data.user_id as string;
    const config = app.get(ConfigService); const url = config.get<string>('SUPABASE_URL')!;
    const signIn = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST',
      headers: { apikey: process.env.QA_ACCESS_ANON_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(10000) });
    if (!signIn.ok) throw new Error(`QA STAFF sign-in HTTP ${signIn.status}`);
    const token = (await signIn.json() as { access_token: string }).access_token;
    const api = () => request(app.getHttpServer());
    const mine = () => api().get('/api/scan-points/my').set('Authorization', `Bearer ${token}`);
    await mine().expect(200).expect({ data: [], count: 0 });
    expect(await users.getScanPointAccess(id)).toEqual({ data: [], count: 0 });
    const points = await database.query('SELECT scan_point_id FROM public.scan_points WHERE is_active ORDER BY scan_point_id LIMIT 2');
    if (points.length !== 2) throw new Error('Two active scan points required');
    const ids = points.map(point => point.scan_point_id as string);
    const first = await users.replaceScanPointAccess(id, [ids[0]], actor);
    expect(first.data[0].assigned_by).toBe(String(actor.user_id));
    await expect(users.replaceScanPointAccess(id, ids, actor)).rejects.toMatchObject({ status: 400 });
    const assigned = await users.replaceScanPointAccess(id, [ids[1]], actor);
    expect(assigned.data.filter(row => row.is_active).map(row => row.scan_point_id)).toEqual([ids[1]]);
    expect(await users.replaceScanPointAccess(id, [ids[1]], actor)).toEqual(assigned);
    expect((await mine().expect(200)).body.data.map((row: { scan_point_id: string }) => row.scan_point_id)).toEqual([ids[1]]);
    const revoked = await users.replaceScanPointAccess(id, [ids[1]], actor);
    expect(revoked.data.find(row => row.scan_point_id === ids[0])?.is_active).toBe(false);
    await users.replaceScanPointAccess(id, [], actor); await mine().expect(200).expect({ data: [], count: 0 });
    const movement = { transaction_id: randomUUID(), scan_code: `QA-NO-CODE-${randomUUID()}`, movement_type: 'IN' };
    await api().post('/api/stock-movements').set('Authorization', `Bearer ${token}`).send(movement).expect(403);
    await api().get(`/api/users/${id}/scan-points`).set('Authorization', `Bearer ${token}`).expect(403);
    await api().put(`/api/users/${id}/scan-points`).set('Authorization', `Bearer ${token}`).send({ scan_point_ids: ids }).expect(403);
    await api().get('/api/scan-points/my?user_id=1').set('Authorization', `Bearer ${token}`).expect(400);
    const direct = await fetch(`${url}/rest/v1/user_scan_point_access`, { method: 'POST', headers: {
      apikey: process.env.QA_ACCESS_ANON_KEY!, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: id, scan_point_id: ids[0], is_active: true }), signal: AbortSignal.timeout(10000) });
    expect(direct.status).toBe(403);
    await users.replaceScanPointAccess(id, [ids[0]], actor);
    await api().post('/api/stock-movements').set('Authorization', `Bearer ${token}`).send({ ...movement, scan_point_id: ids[1] }).expect(403);
    // Unknown QA barcode proves authorization succeeds without creating a live stock movement.
    await api().post('/api/stock-movements').set('Authorization', `Bearer ${token}`).send(movement).expect(404);
    await users.replaceScanPointAccess(id, [ids[1]], actor);
    await api().post('/api/stock-movements').set('Authorization', `Bearer ${token}`).send({ ...movement, scan_point_id: ids[0] }).expect(403);
    await users.update(id, { is_active: false }, actor); await mine().expect(403);
    await users.update(id, { is_active: true, role: 'VIEWER' }, actor);
    await mine().expect(200).expect({ data: [], count: 0 });
    await api().post('/api/stock-movements').set('Authorization', `Bearer ${token}`).send({}).expect(403);
  });
});
