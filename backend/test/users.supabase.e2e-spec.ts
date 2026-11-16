import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

jest.setTimeout(60000);

// Explicit project opt-in. Only uniquely named QA fixtures are created and removed.
const enabled = process.env.QA_USERS_SUPABASE_TEST === '1';
const suite = enabled ? describe : describe.skip;
suite('Users on explicitly configured Supabase test project', () => {
  let app: INestApplication<App>;
  let sql: ReturnType<typeof postgres>;
  let authId: string | undefined;
  let userId: string | undefined;
  let baseline: unknown;
  let usersBaseline: string;
  let accessBaseline: string;
  const required = ['QA_USERS_SUPABASE_URL', 'QA_USERS_SUPABASE_DATABASE_URL', 'QA_USERS_SERVICE_ROLE_KEY', 'QA_USERS_ANON_KEY'] as const;
  const config = Object.fromEntries([...required, 'QA_USERS_ADMIN_EMAIL', 'QA_USERS_ADMIN_PASSWORD', 'QA_USERS_ADMIN_ACCESS_TOKEN'].map(key => [key, process.env[key]]));
  const username = `qa-users-${randomUUID()}`;
  const email = `${username}@example.com`;
  const password = `Qa!${randomUUID()}`;
  const json = async (response: Response) => { if (!response.ok) throw new Error(`Supabase test HTTP ${response.status}`); return response.json(); };
  const signIn = async (email: string, password: string): Promise<string> => {
    const result = await json(await fetch(`${config.QA_USERS_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: config.QA_USERS_ANON_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(10000),
    }));
    if (!result.access_token) throw new Error('Supabase test sign-in missing token');
    return result.access_token as string;
  };
  const state = async () => (await sql.unsafe(`SELECT
    (SELECT md5(COALESCE(string_agg(row_to_json(t)::text,'|' ORDER BY transaction_id),'')) FROM public.stock_transactions t) AS history,
    (SELECT md5(COALESCE(string_agg(row_to_json(i)::text,'|' ORDER BY product_id),'')) FROM public.inventory i) AS inventory`))[0];
  beforeAll(async () => {
    if (required.some(key => !config[key])) throw new Error('Explicit Supabase test configuration incomplete');
    if (!config.QA_USERS_ADMIN_ACCESS_TOKEN && !(config.QA_USERS_ADMIN_EMAIL && config.QA_USERS_ADMIN_PASSWORD)) throw new Error('ADMIN test session required');
    sql = postgres(config.QA_USERS_SUPABASE_DATABASE_URL!, { ssl: 'require', connect_timeout: 5 });
    baseline = await state();
    usersBaseline = (await sql.unsafe("SELECT md5(COALESCE(string_agg(row_to_json(u)::text,'|' ORDER BY user_id),'')) AS hash FROM public.users u"))[0].hash as string;
    accessBaseline = (await sql.unsafe("SELECT md5(COALESCE(string_agg(row_to_json(a)::text,'|' ORDER BY user_id,scan_point_id),'')) AS hash FROM public.user_scan_point_access a"))[0].hash as string;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService).useValue(new ConfigService({ SUPABASE_URL: config.QA_USERS_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: config.QA_USERS_SERVICE_ROLE_KEY }))
      .overrideProvider(DatabaseService).useValue({ query: (text: string, params: (string | number | boolean | null)[] = []) => sql.unsafe(text, params),
        transaction: (fn: (query: (text: string, params?: (string | number | boolean | null)[]) => unknown) => unknown) => sql.begin(tx => fn((text, params = []) => tx.unsafe(text, params))) }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init();
  });
  afterAll(async () => {
    try {
      if (sql) {
        // Discover the unique test fixture even after a lost HTTP response.
        const rows = await sql.unsafe('SELECT u.user_id::text,a.id AS auth_id FROM auth.users a LEFT JOIN public.users u ON u.auth_user_id=a.id AND u.username=$2 WHERE a.email=$1', [email, username]);
        const fixture = rows[0];
        if (fixture?.user_id) await sql.begin(async tx => {
          await tx.unsafe('DELETE FROM public.user_scan_point_access WHERE user_id=$1', [fixture.user_id as string]);
          await tx.unsafe('DELETE FROM public.users WHERE user_id=$1 AND username=$2', [fixture.user_id as string, username]);
        });
        if (fixture?.auth_id) await json(await fetch(`${config.QA_USERS_SUPABASE_URL}/auth/v1/admin/users/${fixture.auth_id as string}`, {
          method: 'DELETE', headers: { apikey: config.QA_USERS_SERVICE_ROLE_KEY!, Authorization: `Bearer ${config.QA_USERS_SERVICE_ROLE_KEY}` }, signal: AbortSignal.timeout(10000),
        }));
        expect(await state()).toEqual(baseline);
        const usersAfter = (await sql.unsafe("SELECT md5(COALESCE(string_agg(row_to_json(u)::text,'|' ORDER BY user_id),'')) AS hash FROM public.users u"))[0].hash;
        expect(usersAfter).toBe(usersBaseline);
        const accessAfter = (await sql.unsafe("SELECT md5(COALESCE(string_agg(row_to_json(a)::text,'|' ORDER BY user_id,scan_point_id),'')) AS hash FROM public.user_scan_point_access a"))[0].hash;
        expect(accessAfter).toBe(accessBaseline);
      }
    } finally { await app?.close(); await sql?.end(); }
  });
  it('provisions a real STAFF identity, verifies UUID/email, signs in, enforces RBAC and lock status', async () => {
    const token = config.QA_USERS_ADMIN_ACCESS_TOKEN ?? await signIn(config.QA_USERS_ADMIN_EMAIL!, config.QA_USERS_ADMIN_PASSWORD!);
    const api = () => request(app.getHttpServer());
    await api().get('/api/users').set('Authorization', `Bearer ${token}`).expect(200);
    const body = { username, display_name: 'QA Users Integration', email, password, role: 'STAFF' };
    const created = await api().post('/api/users').set('Authorization', `Bearer ${token}`).send(body).expect(201);
    authId = created.body.data.auth_user_id; userId = created.body.data.user_id;
    expect(created.body.data).not.toHaveProperty('password');
    const linked = await sql.unsafe('SELECT a.id,a.email,u.role FROM public.users u JOIN auth.users a ON a.id=u.auth_user_id WHERE u.user_id=$1', [userId!]);
    expect(linked[0]).toMatchObject({ id: authId, email, role: 'STAFF' });
    await api().post('/api/users').set('Authorization', `Bearer ${token}`).send({ ...body, username: `${username}x` }).expect(409);
    const staffToken = await signIn(email, password);
    await api().get('/api/auth/me').set('Authorization', `Bearer ${staffToken}`).expect(200).expect(res => { expect(res.body.role).toBe('STAFF'); });
    await api().get('/api/users').set('Authorization', `Bearer ${staffToken}`).expect(403);
    await api().get('/api/scan-points').set('Authorization', `Bearer ${staffToken}`).expect(200);
    const admin = await api().get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    await api().get('/api/scan-points/my').set('Authorization', `Bearer ${staffToken}`).expect(200).expect({ data: [], count: 0 });
    const points = await sql.unsafe('SELECT scan_point_id FROM public.scan_points WHERE is_active ORDER BY scan_point_id LIMIT 2');
    if (points.length < 2) throw new Error('Two active scan points required for live access test');
    const ids = points.map(point => point.scan_point_id as string);
    const grants = (scan_point_ids: string[]) => api().put(`/api/users/${userId}/scan-points`).set('Authorization', `Bearer ${token}`).send({ scan_point_ids });
    await grants(ids).expect(400);
    const assigned = await grants([ids[0]]).expect(200);
    expect(assigned.body.data.map((row: { scan_point_id: string }) => row.scan_point_id)).toEqual([ids[0]]);
    expect(assigned.body.data.every((row: { assigned_by: string }) => row.assigned_by === String(admin.body.user_id))).toBe(true);
    await grants([ids[0]]).expect(200).expect(assigned.body);
    const mine = await api().get('/api/scan-points/my').set('Authorization', `Bearer ${staffToken}`).expect(200);
    expect(mine.body.data.map((row: { scan_point_id: string }) => row.scan_point_id)).toEqual([ids[0]]);
    await api().put(`/api/users/${userId}/scan-points`).set('Authorization', `Bearer ${staffToken}`).send({ scan_point_ids: [] }).expect(403);
    await api().get(`/api/users/${userId}/scan-points`).set('Authorization', `Bearer ${staffToken}`).expect(403);
    const revoked = await grants([ids[1]]).expect(200);
    expect(revoked.body.data.find((row: { scan_point_id: string }) => row.scan_point_id === ids[0]).is_active).toBe(false);
    await grants([]).expect(200);
    await api().get('/api/scan-points/my').set('Authorization', `Bearer ${staffToken}`).expect(200).expect({ data: [], count: 0 });
    const direct = await fetch(`${config.QA_USERS_SUPABASE_URL}/rest/v1/user_scan_point_access`, {
      method: 'POST', headers: { apikey: config.QA_USERS_ANON_KEY!, Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, scan_point_id: ids[0], is_active: true }), signal: AbortSignal.timeout(10000),
    });
    expect(direct.status).toBe(403);
    await grants([ids[0]]).expect(200);
    await api().patch(`/api/users/${userId}`).set('Authorization', `Bearer ${token}`).send({ is_active: false }).expect(200);
    await api().get('/api/auth/me').set('Authorization', `Bearer ${staffToken}`).expect(403);
    await api().get('/api/scan-points/my').set('Authorization', `Bearer ${staffToken}`).expect(403);
    await api().patch(`/api/users/${userId}`).set('Authorization', `Bearer ${token}`).send({ is_active: true, role: 'VIEWER' }).expect(200);
    await api().get('/api/auth/me').set('Authorization', `Bearer ${staffToken}`).expect(200).expect(res => { expect(res.body.role).toBe('VIEWER'); });
    await api().get('/api/scan-points/my').set('Authorization', `Bearer ${staffToken}`).expect(200).expect({ data: [], count: 0 });
    await api().post('/api/stock-movements').set('Authorization', `Bearer ${staffToken}`).send({}).expect(403);
  });
});
