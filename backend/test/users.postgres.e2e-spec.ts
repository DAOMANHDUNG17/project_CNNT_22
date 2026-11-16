import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { JwtVerifierService } from '../src/auth/jwt-verifier.service';
import { SupabaseAdminService } from '../src/users/supabase-admin.service';

const qaUrl = process.env.QA_USERS_DATABASE_URL;
const suite = qaUrl ? describe : describe.skip;
suite('Users with isolated PostgreSQL and Auth transport double', () => {
  let app: INestApplication<App>;
  let sql: ReturnType<typeof postgres>;
  const adminId = '10000000-0000-4000-8000-000000000001';
  const otherId = '10000000-0000-4000-8000-000000000002';
  const create = jest.fn(); const remove = jest.fn();
  const body = { username: 'staff.new', display_name: 'New Staff', email: 'staff@example.test', role: 'STAFF', password: 'qa-password-12345' };
  beforeAll(async () => {
    const url = new URL(qaUrl!);
    if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/qa_users') throw new Error('Only isolated qa_users allowed');
    sql = postgres(qaUrl!, { onnotice: () => undefined });
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY,email text UNIQUE);
      CREATE TABLE IF NOT EXISTS public.users(user_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        auth_user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id),username varchar(50) UNIQUE NOT NULL,
        display_name varchar(120) NOT NULL,role varchar(20) NOT NULL CHECK(role IN ('ADMIN','STAFF','VIEWER')),
        is_active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS public.scan_points(scan_point_id text PRIMARY KEY,point_name text,is_active boolean,created_at timestamptz);`);
    const database = {
      query: (text: string, params: (string | number | boolean | null)[] = []) => sql.unsafe(text, params),
      transaction: (fn: (query: (text: string, params?: (string | number | boolean | null)[]) => unknown) => unknown) => sql.begin(async tx => fn((text, params = []) => tx.unsafe(text, params))),
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService).useValue(database)
      .overrideProvider(JwtVerifierService).useValue({ verify: async (token: string) => token === 'admin' ? adminId : token === 'other' ? otherId : token })
      .overrideProvider(SupabaseAdminService).useValue({ create, remove }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init();
  });
  beforeEach(async () => {
    await sql.unsafe('TRUNCATE public.users, auth.users RESTART IDENTITY CASCADE');
    await sql.unsafe('INSERT INTO auth.users VALUES ($1,$2),($3,$4)', [adminId, 'admin@example.test', otherId, 'other@example.test']);
    await sql.unsafe("INSERT INTO public.users(auth_user_id,username,display_name,role) VALUES ($1,'admin','Admin','ADMIN'),($2,'other','Other','STAFF')", [adminId, otherId]);
    create.mockReset().mockImplementation(async (email: string) => { const id = randomUUID(); await sql.unsafe('INSERT INTO auth.users VALUES ($1,$2)', [id, email]); return id; });
    remove.mockReset().mockImplementation(async (id: string) => { await sql.unsafe('DELETE FROM auth.users WHERE id=$1', [id]); });
  });
  afterAll(async () => { await app?.close(); await sql?.end(); });
  const post = () => request(app.getHttpServer()).post('/api/users').set('Authorization', 'Bearer admin');
  const patch = (id: string, token = 'admin') => request(app.getHttpServer()).patch(`/api/users/${id}`).set('Authorization', `Bearer ${token}`);
  const get = (suffix = '', token = 'admin') => request(app.getHttpServer()).get(`/api/users${suffix}`).set('Authorization', `Bearer ${token}`);

  it('creates linked Auth/profile and the resulting STAFF identity is checked by the existing AuthGuard', async () => {
    const response = await post().send(body).expect(201);
    const user = response.body.data;
    expect(user).toMatchObject({ user_id: '3', email: body.email, role: 'STAFF', is_active: true });
    expect(user).not.toHaveProperty('password');
    const linked = await sql.unsafe('SELECT u.auth_user_id,a.email FROM public.users u JOIN auth.users a ON a.id=u.auth_user_id WHERE u.user_id=$1', [user.user_id]);
    expect(linked[0].auth_user_id).toBe(user.auth_user_id);
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${user.auth_user_id}`).expect(200).expect(res => { expect(res.body.role).toBe('STAFF'); });
    await get('', user.auth_user_id).expect(403);
    await request(app.getHttpServer()).get('/api/scan-points').set('Authorization', `Bearer ${user.auth_user_id}`).expect(200);
  });
  it('rejects duplicate email and username without creating Auth twice', async () => {
    await post().send(body).expect(201);
    await post().send({ ...body, username: 'unique' }).expect(409);
    await post().send({ ...body, email: 'unique@example.test' }).expect(409);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('serializes concurrent same-email requests', async () => {
    const result = await Promise.all([post().send(body), post().send({ ...body, username: 'other.new' })]);
    expect(result.map(row => row.status).sort((a, b) => a - b)).toEqual([201, 409]); expect(create).toHaveBeenCalledTimes(1);
  });
  it('uses combined filters and retains count beyond the last page', async () => {
    await post().send(body).expect(201);
    const response = await get('?q=staff&role=STAFF&isActive=true&page=1&limit=1').expect(200);
    expect(response.body.count).toBe(1); expect(response.body.data[0].username).toBe(body.username);
    const empty = await get('?page=10&limit=1').expect(200); expect(empty.body.count).toBe(3); expect(empty.body.data).toEqual([]);
  });
  it('updates name, username and role with parameterized SQL', async () => {
    const response = await patch('2').send({ display_name: "Name ' quote", username: 'renamed', role: 'VIEWER' }).expect(200);
    expect(response.body.data).toMatchObject({ display_name: "Name ' quote", username: 'renamed', role: 'VIEWER' });
    await get('', 'other').expect(403);
  });
  it('locks and unlocks an account, rejecting its existing identity while inactive', async () => {
    await patch('2').send({ is_active: false }).expect(200);
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', 'Bearer other').expect(403);
    await patch('2').send({ is_active: true }).expect(200);
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', 'Bearer other').expect(200);
  });
  it.each([{ role: 'STAFF' }, { is_active: false }])('protects last active ADMIN from %j', async dto => {
    await patch('1').send(dto).expect(409);
    await get().expect(200);
  });
  it('serializes concurrent attempts to remove both active ADMIN roles', async () => {
    await patch('2').send({ role: 'ADMIN' }).expect(200);
    const results = await Promise.all([patch('1').send({ role: 'VIEWER' }), patch('2', 'other').send({ is_active: false })]);
    expect(results.filter(row => row.status === 200)).toHaveLength(1);
    expect(results.filter(row => row.status === 409)).toHaveLength(1);
    const admins = await sql.unsafe("SELECT count(*)::int AS count FROM public.users WHERE role='ADMIN' AND is_active"); expect(admins[0].count).toBe(1);
  });
  it('rolls back profile and compensates Auth on insert constraint failure', async () => {
    await sql.unsafe("ALTER TABLE public.users ADD CONSTRAINT qa_insert_failure CHECK (username <> 'staff.new')");
    try { await post().send(body).expect(500); expect(remove).toHaveBeenCalledTimes(1);
      expect((await sql.unsafe('SELECT count(*)::int AS n FROM public.users'))[0].n).toBe(2);
      expect((await sql.unsafe('SELECT count(*)::int AS n FROM auth.users'))[0].n).toBe(2);
    } finally { await sql.unsafe('ALTER TABLE public.users DROP CONSTRAINT qa_insert_failure'); }
  });
  it('Auth failure creates no profile', async () => {
    create.mockRejectedValue(new Error('Auth unavailable')); await post().send(body).expect(500);
    expect((await sql.unsafe('SELECT count(*)::int AS n FROM public.users'))[0].n).toBe(2);
  });
  it('reports unknown target and out-of-range BIGINT safely', async () => {
    await patch('999').send({ role: 'VIEWER' }).expect(404);
    await patch('9223372036854775808').send({ role: 'VIEWER' }).expect(400);
  });
});
