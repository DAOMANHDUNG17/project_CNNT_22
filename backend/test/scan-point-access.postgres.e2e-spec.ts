import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { JwtVerifierService } from '../src/auth/jwt-verifier.service';

const qaUrl = process.env.QA_ACCESS_DATABASE_URL;
const suite = qaUrl ? describe : describe.skip;
suite('Scan point access with isolated PostgreSQL', () => {
  let app: INestApplication<App>; let sql: ReturnType<typeof postgres>;
  const authId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  beforeAll(async () => {
    const url = new URL(qaUrl!);
    if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/qa_access') throw new Error('Isolated qa_access database required');
    sql = postgres(qaUrl!, { onnotice: () => undefined });
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS public.users(user_id bigint PRIMARY KEY,auth_user_id uuid UNIQUE NOT NULL,
      username text NOT NULL,display_name text NOT NULL,role text NOT NULL,is_active boolean NOT NULL);
      CREATE TABLE IF NOT EXISTS public.scan_points(scan_point_id varchar(20) PRIMARY KEY,point_name text,is_active boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS public.user_scan_point_access(user_id bigint NOT NULL REFERENCES public.users(user_id),
        scan_point_id varchar(20) NOT NULL REFERENCES public.scan_points(scan_point_id),is_active boolean NOT NULL DEFAULT true,
        assigned_by bigint REFERENCES public.users(user_id),assigned_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,scan_point_id));`);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService).useValue({ query: (text: string, params: (string | number | boolean | null)[] = []) => sql.unsafe(text, params),
        transaction: (fn: (query: (text: string, params?: (string | number | boolean | null)[]) => unknown) => unknown) => sql.begin(tx => fn((text, params = []) => tx.unsafe(text, params))) })
      .overrideProvider(JwtVerifierService).useValue({ verify: async (token: string) => authId(Number(token)) }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init();
  });
  beforeEach(async () => {
    await sql.unsafe('TRUNCATE public.user_scan_point_access,public.users,public.scan_points CASCADE');
    for (const [n, role, active] of [[1, 'ADMIN', true], [2, 'STAFF', true], [3, 'VIEWER', true], [4, 'STAFF', false], [5, 'ADMIN', true]] as const) {
      await sql.unsafe('INSERT INTO public.users VALUES($1,$2,$3,$3,$4,$5)', [String(n), authId(n), `qa${n}`, role, active]);
    }
    await sql.unsafe("INSERT INTO public.scan_points(scan_point_id,point_name,is_active) VALUES ('SCAN-01','Gate 1',true),('SCAN-02','Gate 2',true),('SCAN-03','Inactive',false)");
  });
  afterAll(async () => { await app?.close(); await sql?.end(); });
  const put = (ids: string[], user = '2', actor = '1') => request(app.getHttpServer()).put(`/api/users/${user}/scan-points`).set('Authorization', `Bearer ${actor}`).send({ scan_point_ids: ids });
  const get = (user = '2', actor = '1') => request(app.getHttpServer()).get(`/api/users/${user}/scan-points`).set('Authorization', `Bearer ${actor}`);
  const mine = (actor: string) => request(app.getHttpServer()).get('/api/scan-points/my').set('Authorization', `Bearer ${actor}`);
  const activeIds = (response: { body: { data: { scan_point_id: string; is_active: boolean }[] } }) => response.body.data.filter(row => row.is_active).map(row => row.scan_point_id);

  it('ADMIN reads an empty list for an existing user', async () => { await get().expect(200).expect({ data: [], count: 0 }); });
  it('grants SCAN-01 with backend assigned_by and string BIGINT', async () => {
    const r = await put(['SCAN-01']).expect(200);
    expect(r.body.data[0]).toMatchObject({ user_id: '2', scan_point_id: 'SCAN-01', is_active: true, assigned_by: '1', scan_point_is_active: true });
  });
  it('grants both points and returns only current account grants from my', async () => {
    await put(['SCAN-01', 'SCAN-02'], '5').expect(200);
    const r = await mine('5').expect(200); expect(r.body.data.map((row: { scan_point_id: string }) => row.scan_point_id)).toEqual(['SCAN-01', 'SCAN-02']);
    await mine('1').expect(200).expect({ data: [], count: 0 });
    await mine('2').expect(200).expect({ data: [], count: 0 });
  });
  it('revokes SCAN-01, preserving inactive grant audit data', async () => {
    await put(['SCAN-01']).expect(200);
    const r = await put(['SCAN-02'], '2', '5').expect(200);
    expect(activeIds(r)).toEqual(['SCAN-02']);
    expect(r.body.data[0]).toMatchObject({ scan_point_id: 'SCAN-01', is_active: false, assigned_by: '5' });
  });
  it('empty selection revokes all immediately', async () => {
    await put(['SCAN-01']).expect(200); await put([]).expect(200);
    await mine('2').expect(200).expect({ data: [], count: 0 }); expect(activeIds(await get().expect(200))).toEqual([]);
  });
  it('repeated save creates no duplicates or false assignment timestamp changes', async () => {
    const first = await put(['SCAN-01']).expect(200); const second = await put(['SCAN-01']).expect(200);
    expect(second.body).toEqual(first.body);
    const count = await sql.unsafe('SELECT count(*)::int AS count FROM public.user_scan_point_access'); expect(count[0].count).toBe(1);
  });
  it('reactivates a revoked grant rather than inserting a duplicate', async () => {
    await put(['SCAN-01']).expect(200); await put([]).expect(200);
    const r = await put(['SCAN-01'], '2', '5').expect(200); expect(r.body.count).toBe(1); expect(r.body.data[0].assigned_by).toBe('5');
  });
  it('does not give ADMIN an implicit scan grant', async () => {
    await mine('1').expect(200).expect({ data: [], count: 0 });
    await put(['SCAN-02'], '1').expect(200);
    const r = await mine('1').expect(200); expect(r.body.data.map((row: { scan_point_id: string }) => row.scan_point_id)).toEqual(['SCAN-02']);
  });
  it('VIEWER old grants confer neither scan list nor movement privileges', async () => {
    await put(['SCAN-01'], '3').expect(200);
    await mine('3').expect(200).expect({ data: [], count: 0 });
    await request(app.getHttpServer()).post('/api/stock-movements').set('Authorization', 'Bearer 3').send({}).expect(403);
    await sql.unsafe("UPDATE public.users SET role='VIEWER' WHERE user_id=2");
    await put(['SCAN-02']).expect(200); await mine('2').expect(200).expect({ data: [], count: 0 });
  });
  it('filters points disabled after assignment while preserving admin grant history', async () => {
    await put(['SCAN-01']).expect(200); await sql.unsafe("UPDATE public.scan_points SET is_active=false WHERE scan_point_id='SCAN-01'");
    await mine('2').expect(200).expect({ data: [], count: 0 });
    const r = await get().expect(200); expect(r.body.data[0]).toMatchObject({ is_active: true, scan_point_is_active: false });
    await put(['SCAN-01']).expect(400); await put([]).expect(200);
  });
  it('inactive or nonexistent point cannot partially revoke current grants', async () => {
    await put(['SCAN-01']).expect(200);
    await put(['SCAN-03']).expect(400); await put(['NO-POINT']).expect(404);
    expect(activeIds(await get().expect(200))).toEqual(['SCAN-01']);
  });
  it('rolls back revocation if a later insert fails', async () => {
    await put(['SCAN-01']).expect(200);
    const before = await get().expect(200);
    await sql.unsafe("ALTER TABLE public.user_scan_point_access ADD CONSTRAINT qa_fail_insert CHECK(scan_point_id <> 'SCAN-02')");
    try { await put(['SCAN-02']).expect(503); expect((await get().expect(200)).body).toEqual(before.body); }
    finally { await sql.unsafe('ALTER TABLE public.user_scan_point_access DROP CONSTRAINT qa_fail_insert'); }
  });
  it('serializes complete replacement by two ADMIN actors', async () => {
    const results = await Promise.all([put(['SCAN-01']), put(['SCAN-02'], '2', '5')]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    const final = await get().expect(200); expect(activeIds(final)).toHaveLength(1);
    expect(final.body.count).toBe(2);
  });
  it('locked accounts cannot access my even with existing grants', async () => {
    await put(['SCAN-01'], '4').expect(200); await mine('4').expect(403);
  });
  it('missing user returns 404 for GET and PUT', async () => { await get('999').expect(404); await put([], '999').expect(404); });
  it('rejects multiple STAFF assignments and unsafe role change from multi-grant ADMIN', async () => {
    await put(['SCAN-01', 'SCAN-02']).expect(400);
    await put(['SCAN-01', 'SCAN-02'], '5').expect(200);
    await request(app.getHttpServer()).patch('/api/users/5').set('Authorization', 'Bearer 1').send({ role: 'STAFF' }).expect(409);
  });
});
