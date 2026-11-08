import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
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
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
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

  it('requires authentication for /api/scan-points', async () => {
    await request(app.getHttpServer()).get('/api/scan-points').expect(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns scan points from public.scan_points for an authenticated VIEWER', async () => {
    const point = {
      scan_point_id: 'SCAN-01',
      point_name: 'Receiving desk',
      is_active: true,
      created_at: new Date('2026-01-02T00:00:00.000Z'),
    };
    query.mockImplementation((sql: string) =>
      sql.includes('FROM public.users')
        ? [{ ...businessUser, role: 'VIEWER' }]
        : [point],
    );

    await request(app.getHttpServer())
      .get('/api/scan-points')
      .set('Authorization', 'Bearer valid-token')
      .expect(200)
      .expect({
        data: [{ ...point, created_at: point.created_at.toISOString() }],
        count: 1,
      });
    expect(query).toHaveBeenNthCalledWith(2,
      'SELECT scan_point_id, point_name, is_active, created_at FROM public.scan_points ORDER BY scan_point_id',
    );
  });

  it('documents bearer authorization for GET /api/scan-points', () => {
    const config = new DocumentBuilder().addBearerAuth().build();
    const document = SwaggerModule.createDocument(app, config);
    expect(document.paths['/api/scan-points']?.get?.security).toEqual([
      { bearer: [] },
    ]);
    expect(document.paths['/api/scan-points']?.get?.responses?.['200']).toBeDefined();
  });

  it('requires a bearer token for /api/product-units', async () => {
    await request(app.getHttpServer()).get('/api/product-units').expect(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an invalid bearer token for /api/product-units', async () => {
    verify.mockRejectedValue(new Error('invalid token'));
    await request(app.getHttpServer())
      .get('/api/product-units')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns product units joined with products and preserves a BIGINT ID', async () => {
    const unit = {
      product_unit_id: '9007199254740993',
      product_id: 'SP001',
      product_name: 'Product 1',
      unit_name: 'box',
      conversion_factor: 12,
      scan_code: 'SW-SP001-02',
      is_base_unit: false,
      created_at: new Date('2026-01-02T00:00:00.000Z'),
    };
    query.mockImplementation((sql: string) =>
      sql.includes('FROM public.users')
        ? [{ ...businessUser, role: 'VIEWER' }]
        : [unit],
    );

    await request(app.getHttpServer())
      .get('/api/product-units')
      .set('Authorization', 'Bearer valid-token')
      .expect(200)
      .expect({
        data: [{ ...unit, created_at: unit.created_at.toISOString() }],
        count: 1,
      });
    expect(query).toHaveBeenNthCalledWith(2,
      'SELECT u.product_unit_id, u.product_id, p.product_name, u.unit_name, u.conversion_factor, u.scan_code, u.is_base_unit, u.created_at FROM public.product_units AS u JOIN public.products AS p ON p.product_id = u.product_id ORDER BY u.product_id, u.is_base_unit DESC, u.product_unit_id',
    );
  });

  it('documents bearer authorization for GET /api/product-units', () => {
    const config = new DocumentBuilder().addBearerAuth().build();
    const document = SwaggerModule.createDocument(app, config);
    expect(document.paths['/api/product-units']?.get?.security).toEqual([
      { bearer: [] },
    ]);
    expect(document.paths['/api/product-units']?.get?.responses?.['200']).toBeDefined();
  });

  it('requires authentication for POST /api/products', async () => {
    await request(app.getHttpServer()).post('/api/products')
      .send({ product_id: 'SP013', product_name: 'New product', base_unit: 'piece' })
      .expect(401);
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['STAFF', 'VIEWER'])('rejects %s on POST /api/products', async (role) => {
    query.mockResolvedValue([{ ...businessUser, role }]);
    await request(app.getHttpServer()).post('/api/products')
      .set('Authorization', 'Bearer valid-token')
      .send({ product_id: 'SP013', product_name: 'New product', base_unit: 'piece' })
      .expect(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('creates a product as ADMIN using only one parameterized products INSERT', async () => {
    const product = {
      product_id: 'SP013',
      product_name: 'New product',
      base_unit: 'piece',
      is_active: true,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    query.mockImplementation((sql: string) =>
      sql.includes('FROM public.users') ? [businessUser] : [product],
    );
    await request(app.getHttpServer()).post('/api/products')
      .set('Authorization', 'Bearer valid-token')
      .send({ product_id: ' SP013 ', product_name: ' New product ', base_unit: ' piece ' })
      .expect(201)
      .expect({ data: {
        ...product,
        created_at: product.created_at.toISOString(),
        updated_at: product.updated_at.toISOString(),
      } });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(2,
      'INSERT INTO public.products (product_id, product_name, base_unit) VALUES ($1, $2, $3) RETURNING product_id, product_name, base_unit, is_active, created_at, updated_at',
      ['SP013', 'New product', 'piece'],
    );
  });

  it.each([
    { product_id: '', product_name: 'Name', base_unit: 'piece' },
    { product_id: 'SP013', product_name: '  ', base_unit: 'piece' },
    { product_id: 'SP013', product_name: 'Name', base_unit: '' },
    { product_id: 'X'.repeat(21), product_name: 'Name', base_unit: 'piece' },
    { product_id: 'SP013', product_name: 'Name', base_unit: 'piece', is_active: false },
    { product_id: 'SP013', product_name: 'Name', base_unit: 'piece', quantity: 10 },
  ])('rejects invalid or extra product fields: %j', async (body) => {
    await request(app.getHttpServer()).post('/api/products')
      .set('Authorization', 'Bearer valid-token')
      .send(body)
      .expect(400);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('maps a duplicate product ID to 409', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes('FROM public.users')) return [businessUser];
      throw Object.assign(new Error('duplicate'), { code: '23505' });
    });
    await request(app.getHttpServer()).post('/api/products')
      .set('Authorization', 'Bearer valid-token')
      .send({ product_id: 'SP001', product_name: 'Name', base_unit: 'piece' })
      .expect(409);
  });

  it('documents the POST body, bearer authorization and 201 response', () => {
    const config = new DocumentBuilder().addBearerAuth().build();
    const document = SwaggerModule.createDocument(app, config);
    const post = document.paths['/api/products']?.post;
    expect(post?.security).toEqual([{ bearer: [] }]);
    expect(post?.requestBody).toBeDefined();
    expect(post?.responses?.['201']).toBeDefined();
  });

  afterEach(async () => {
    await app.close();
  });
});
