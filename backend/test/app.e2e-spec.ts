import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { JwtVerifierService } from './../src/auth/jwt-verifier.service';
import { DatabaseService } from './../src/database/database.service';

describe('API (e2e)', () => {
  let app: INestApplication<App>;
  const checkHealth = jest.fn();
  const query = jest.fn();
  const verify = jest.fn();
  const businessUser = {
    user_id: '42',
    auth_user_id: '11111111-1111-4111-8111-111111111111',
    username: 'warehouse-admin',
    display_name: 'Warehouse Admin',
    role: 'ADMIN',
    is_active: true,
  };

  beforeEach(async () => {
    checkHealth.mockReset().mockResolvedValue(undefined);
    query.mockReset().mockResolvedValue([businessUser]);
    verify.mockReset().mockResolvedValue(businessUser.auth_user_id);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({ checkHealth, query })
      .overrideProvider(JwtVerifierService)
      .useValue({ verify })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  it('/api/health (GET)', () => {
    return request(app.getHttpServer()).get('/api/health').expect(200).expect({
      status: 'ok',
      service: 'smart-warehouse-api',
      database: 'connected',
    });
  });

  it('/api/health/database (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/health/database')
      .expect(200)
      .expect({ status: 'ok', database: 'connected' });
  });

  it('returns 503 without connection details when the database fails', () => {
    checkHealth.mockRejectedValue(new Error('sensitive connection detail'));
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(503)
      .expect({ status: 'error', database: 'disconnected' });
  });

  it('requires a bearer token for /api/auth/me', () => {
    return request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it('returns only the business profile for /api/auth/me', () => {
    return request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer valid-token')
      .expect(200)
      .expect({
        user_id: '42',
        username: 'warehouse-admin',
        display_name: 'Warehouse Admin',
        role: 'ADMIN',
        is_active: true,
      });
  });

  it('allows ADMIN on /api/auth/admin-check', () => {
    return request(app.getHttpServer())
      .get('/api/auth/admin-check')
      .set('Authorization', 'Bearer valid-token')
      .expect(200)
      .expect({ status: 'ok', role: 'ADMIN' });
  });

  it('rejects STAFF on /api/auth/admin-check', () => {
    query.mockResolvedValue([{ ...businessUser, role: 'STAFF' }]);
    return request(app.getHttpServer())
      .get('/api/auth/admin-check')
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
  });

  it('requires authentication for /api/products', async () => {
    await request(app.getHttpServer()).get('/api/products').expect(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns products from public.products for an authenticated VIEWER', async () => {
    const product = {
      product_id: 'SP001',
      product_name: 'Product 1',
      base_unit: 'piece',
      is_active: true,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-02T00:00:00.000Z'),
    };
    query.mockImplementation((sql: string) =>
      sql.includes('FROM public.users')
        ? [{ ...businessUser, role: 'VIEWER' }]
        : [product],
    );

    await request(app.getHttpServer())
      .get('/api/products')
      .set('Authorization', 'Bearer valid-token')
      .expect(200)
      .expect({
        data: [{ ...product, created_at: product.created_at.toISOString(), updated_at: product.updated_at.toISOString() }],
        count: 1,
      });
    expect(query).toHaveBeenNthCalledWith(2,
      'SELECT product_id, product_name, base_unit, is_active, created_at, updated_at FROM public.products ORDER BY product_id',
    );
  });

  it('documents bearer authorization for GET /api/products', () => {
    const config = new DocumentBuilder().addBearerAuth().build();
    const document = SwaggerModule.createDocument(app, config);
    expect(document.paths['/api/products']?.get?.security).toEqual([
      { bearer: [] },
    ]);
    expect(document.paths['/api/products']?.get?.responses?.['200']).toBeDefined();
  });

  it('requires authentication for /api/inventory', async () => {
    await request(app.getHttpServer()).get('/api/inventory').expect(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns inventory joined with products for an authenticated VIEWER', async () => {
    const item = {
      product_id: 'SP001',
      product_name: 'Product 1',
      base_unit: 'piece',
      is_active: true,
      quantity_base: '240',
      updated_at: new Date('2026-01-02T00:00:00.000Z'),
    };
    query.mockImplementation((sql: string) =>
      sql.includes('FROM public.users')
        ? [{ ...businessUser, role: 'VIEWER' }]
        : [item],
    );

    await request(app.getHttpServer())
      .get('/api/inventory')
      .set('Authorization', 'Bearer valid-token')
      .expect(200)
      .expect({
        data: [{ ...item, updated_at: item.updated_at.toISOString() }],
        count: 1,
      });
    expect(query).toHaveBeenNthCalledWith(2,
      'SELECT i.product_id, p.product_name, p.base_unit, p.is_active, i.quantity_base, i.updated_at FROM public.inventory AS i JOIN public.products AS p ON p.product_id = i.product_id ORDER BY i.product_id',
    );
  });

  it('documents bearer authorization for GET /api/inventory', () => {
    const config = new DocumentBuilder().addBearerAuth().build();
    const document = SwaggerModule.createDocument(app, config);
    expect(document.paths['/api/inventory']?.get?.security).toEqual([
      { bearer: [] },
    ]);
    expect(document.paths['/api/inventory']?.get?.responses?.['200']).toBeDefined();
  });

  afterEach(async () => {
    await app.close();
  });
});
