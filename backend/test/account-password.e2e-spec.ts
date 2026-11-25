import { BadRequestException, INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { createApiDocument } from '../src/api-docs';
import { DatabaseService } from '../src/database/database.service';
import { JwtVerifierService } from '../src/auth/jwt-verifier.service';
import { SupabaseAdminService } from '../src/users/supabase-admin.service';

describe('Account passwords HTTP (isolated DB/Auth doubles; no production requests)', () => {
  let app: INestApplication<App>;
  let role = 'ADMIN', active = true, actorId = 0, recheckedRole = 'ADMIN';
  const actorAuth = '10000000-0000-4000-8000-000000000001';
  const targetAuth = '10000000-0000-4000-8000-000000000002';
  const targetId = '9007199254740993';
  const query = jest.fn(), verify = jest.fn(), resetPassword = jest.fn(), changeOwnPassword = jest.fn(), passwordIdentity = jest.fn();
  const body = { new_password: 'synthetic-next-123', confirm_password: 'synthetic-next-123' };
  const own = { ...body, current_password: 'synthetic-current-123' };
  let audit: jest.SpyInstance;
  beforeAll(async () => {
    audit = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService).useValue({ query, transaction: (work: (query: typeof query) => unknown) => work(query) })
      .overrideProvider(JwtVerifierService).useValue({ verify })
      .overrideProvider(SupabaseAdminService).useValue({ resetPassword, changeOwnPassword, passwordIdentity }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, validationError: { target: false, value: false } }));
    await app.init();
  });
  beforeEach(() => {
    actorId++; role = 'ADMIN'; active = true; recheckedRole = 'ADMIN'; audit.mockClear();
    verify.mockReset().mockResolvedValue(actorAuth);
    passwordIdentity.mockReset().mockResolvedValue({ email: 'synthetic@example.test' });
    changeOwnPassword.mockReset().mockResolvedValue({ refresh_sessions_revoked: true });
    resetPassword.mockReset().mockResolvedValue(undefined);
    query.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes('WHERE auth_user_id')) return [{ user_id: String(actorId), auth_user_id: actorAuth, username: 'synthetic', display_name: 'Synthetic User', role, is_active: active }];
      if (sql.includes('SELECT role, is_active')) return [{ role: recheckedRole, is_active: active }];
      if (sql.includes('SELECT auth_user_id')) return [{ auth_user_id: targetAuth }];
      return [];
    });
  });
  afterAll(async () => { await app.close(); audit.mockRestore(); });
  const patch = (path = `/api/users/${targetId}/password`) => request(app.getHttpServer()).patch(path).set('Authorization', 'Bearer fixture-jwt');
  it('requires JWT for profile and both password routes', async () => {
    await request(app.getHttpServer()).get('/api/account').expect(401);
    await request(app.getHttpServer()).patch('/api/account/password').send(own).expect(401);
    await request(app.getHttpServer()).patch(`/api/users/${targetId}/password`).send(body).expect(401);
    expect(resetPassword).not.toHaveBeenCalled(); expect(changeOwnPassword).not.toHaveBeenCalled();
  });
  it.each(['ADMIN', 'STAFF', 'VIEWER'])('allows %s own profile only and self change with relogin', async value => {
    role = value;
    const profile = await request(app.getHttpServer()).get('/api/account').set('Authorization', 'Bearer fixture-jwt').expect(200);
    expect(profile.body).toEqual({ user_id: String(actorId), username: 'synthetic', display_name: 'Synthetic User', role, email: 'synthetic@example.test' });
    const response = await patch('/api/account/password').send(own).expect(200);
    expect(response.body).toEqual({ changed: true, requires_relogin: true, refresh_sessions_revoked: true });
    expect(changeOwnPassword).toHaveBeenCalledWith('fixture-jwt', actorAuth, own.current_password, own.new_password);
  });
  it.each(['STAFF', 'VIEWER'])('denies %s directly calling Admin password endpoint', async value => {
    role = value; await patch().send(body).expect(403); expect(resetPassword).not.toHaveBeenCalled();
  });
  it('denies inactive actor before Auth calls', async () => {
    active = false; await patch().send(body).expect(403); await patch('/api/account/password').send(own).expect(403);
    expect(resetPassword).not.toHaveBeenCalled(); expect(changeOwnPassword).not.toHaveBeenCalled();
  });
  it('rechecks ADMIN at mutation time and rejects a demoted actor', async () => {
    recheckedRole = 'STAFF'; await patch().send(body).expect(403); expect(resetPassword).not.toHaveBeenCalled();
  });
  it.each([{ new_password: 'short', confirm_password: 'short' }, { confirm_password: 'different-valid-123' }, { new_password: null }, { current_password: own.current_password, new_password: own.current_password, confirm_password: own.current_password }, { user_id: targetId }])('rejects invalid self password input case %#', async input => {
    await patch('/api/account/password').send({ ...own, ...input }).expect(400); expect(changeOwnPassword).not.toHaveBeenCalled();
  });
  it('returns wrong current password error from reauthentication, without exposing provider details', async () => {
    changeOwnPassword.mockRejectedValueOnce(new BadRequestException('Mật khẩu hiện tại không đúng.'));
    const response = await patch('/api/account/password').send(own).expect(400);
    expect(response.body.message).toBe('Mật khẩu hiện tại không đúng.');
  });
  it('reports successful password update even when session logout is unconfirmed', async () => {
    changeOwnPassword.mockResolvedValueOnce({ refresh_sessions_revoked: false });
    const response = await patch('/api/account/password').send(own).expect(200);
    expect(response.body).toEqual({ changed: true, requires_relogin: true, refresh_sessions_revoked: false });
  });
  it('ADMIN maps BIGINT to correct Auth UUID and changes no profile, role or scan-point assignments', async () => {
    const response = await patch().send(body).expect(200);
    expect(response.body).toEqual({ changed: true, requires_relogin: false, refresh_sessions_revoked: false });
    expect(resetPassword).toHaveBeenCalledWith(targetAuth, body.new_password);
    expect(query.mock.calls.every(([sql]) => /^SELECT /i.test(sql))).toBe(true);
    const serialized = JSON.stringify([response.body, audit.mock.calls]);
    for (const text of [own.current_password, body.new_password, 'fixture-jwt', targetAuth]) expect(serialized).not.toContain(text);
    expect(audit).toHaveBeenCalledWith(expect.stringContaining('"result":"reset"'));
  });
  it('rejects ADMIN self reset and points to personal settings', async () => {
    await patch(`/api/users/${actorId}/password`).send(body).expect(400); expect(resetPassword).not.toHaveBeenCalled();
  });
  it('returns 404 when business target does not exist', async () => {
    const original = query.getMockImplementation()!;
    query.mockImplementation((sql: string, ...params: unknown[]) => sql.includes('SELECT auth_user_id') ? [] : original(sql, ...params));
    await patch().send(body).expect(404); expect(resetPassword).not.toHaveBeenCalled();
  });
  it('rejects malformed Auth binding', async () => {
    const original = query.getMockImplementation()!;
    query.mockImplementation((sql: string, ...params: unknown[]) => sql.includes('SELECT auth_user_id') ? [{ auth_user_id: 'invalid' }] : original(sql, ...params));
    await patch().send(body).expect(503); expect(resetPassword).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', '9223372036854775808', '1.2', targetAuth])('rejects invalid business ID case %#', async id => {
    await patch(`/api/users/${id}/password`).send(body).expect(400); expect(resetPassword).not.toHaveBeenCalled();
  });
  it.each([{ new_password: 'short', confirm_password: 'short' }, { confirm_password: 'different-valid-123' }, { role: 'ADMIN' }, { auth_user_id: targetAuth }])('rejects invalid Admin input case %#', async input => {
    await patch().send({ ...body, ...input }).expect(400); expect(resetPassword).not.toHaveBeenCalled();
  });
  it('sanitizes unexpected failures without logging password or raw exception', async () => {
    resetPassword.mockRejectedValueOnce(new Error('fixture-private'));
    const response = await patch().send(body).expect(503);
    const output = JSON.stringify([response.body, audit.mock.calls]);
    for (const value of ['fixture-private', body.new_password, 'fixture-jwt']) expect(output).not.toContain(value);
  });
  it('shares actor rate limit across Admin reset and self-change', async () => {
    for (let i = 0; i < 5; i++) await patch().send(body).expect(200);
    await patch('/api/account/password').send(own).expect(429);
    expect(resetPassword).toHaveBeenCalledTimes(5); expect(changeOwnPassword).not.toHaveBeenCalled();
  });
  it('publishes guarded OpenAPI routes with write-only password fields', () => {
    const document = createApiDocument(app);
    expect(document.paths['/api/account']).toHaveProperty('get.security');
    expect(document.paths['/api/account/password']).toHaveProperty('patch.security');
    expect(document.paths['/api/users/{id}/password']).toHaveProperty('patch.security');
    expect(document.components?.schemas?.ChangePasswordDto).toHaveProperty('properties.current_password.writeOnly', true);
    expect(document.components?.schemas?.ResetPasswordDto).toHaveProperty('properties.new_password.writeOnly', true);
  });
});
