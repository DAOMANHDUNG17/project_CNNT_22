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
  const transaction = jest.fn(async (work: (execute: typeof query) => Promise<unknown>) => work(query));
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
    transaction.mockReset().mockImplementation(async (work: (execute: typeof query) => Promise<unknown>) => work(query));
    verify.mockReset().mockResolvedValue(businessUser.auth_user_id);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({ checkHealth, query, transaction })
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

  const existingProduct = {
    product_id: 'SP013', product_name: 'Bút mực', base_unit: 'cây', is_active: true,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-02T00:00:00.000Z'),
  };

  function mockProductPatch(options: { quantity?: string | null; product?: typeof existingProduct | null } = {}) {
    let product = options.product === undefined ? { ...existingProduct } : options.product && { ...options.product };
    const inventory = options.quantity === undefined ? '0' : options.quantity;
    query.mockImplementation((sql: string, parameters?: unknown[]) => {
      if (sql.includes('FROM public.users')) return [businessUser];
      if (sql.includes('FROM public.products WHERE') && sql.includes('FOR UPDATE')) {
        return product && parameters?.[0] === product.product_id ? [{ ...product }] : [];
      }
      if (sql.includes('FROM public.inventory WHERE') && sql.includes('FOR UPDATE')) {
        return inventory === null ? [] : [{ quantity_base: inventory }];
      }
      if (sql.startsWith('UPDATE public.products')) {
        product = { ...product!, product_name: parameters![1] as string,
          is_active: parameters![2] as boolean, updated_at: new Date('2026-01-03T00:00:00.000Z') };
        return [{ ...product }];
      }
      throw new Error('Unexpected SQL');
    });
    return () => product;
  }

  it('requires JWT and ADMIN for PATCH /api/products/:id', async () => {
    await request(app.getHttpServer()).patch('/api/products/SP013').send({ product_name: 'New' }).expect(401);
    expect(query).not.toHaveBeenCalled();
    for (const role of ['STAFF', 'VIEWER']) {
      query.mockResolvedValue([{ ...businessUser, role }]);
      await request(app.getHttpServer()).patch('/api/products/SP013')
        .set('Authorization', 'Bearer valid-token').send({ product_name: 'New' }).expect(403);
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    {}, { product_name: '' }, { product_name: '  ' }, { product_name: null },
    { product_name: 7 }, { product_name: 'x'.repeat(151) },
    { is_active: null }, { is_active: 'false' }, { is_active: 1 },
    { product_id: 'OTHER' }, { base_unit: 'box' }, { quantity_base: '0' },
    { product_name: 'New', scan_code: 'ABC' }, { product_name: 'New', updated_at: '2026-01-01' },
  ])('rejects invalid PATCH body %j', async body => {
    await request(app.getHttpServer()).patch('/api/products/SP013')
      .set('Authorization', 'Bearer valid-token').send(body).expect(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['%20', 'X'.repeat(21)])('rejects invalid product ID %s', async id => {
    await request(app.getHttpServer()).patch(`/api/products/${id}`)
      .set('Authorization', 'Bearer valid-token').send({ product_name: 'New' }).expect(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('trims and updates only the product name even with stock and history', async () => {
    mockProductPatch({ quantity: '240' });
    await request(app.getHttpServer()).patch('/api/products/SP013')
      .set('Authorization', 'Bearer valid-token')
      .send({ product_name: ' Bút mực Hồng Hà ' }).expect(200)
      .expect({ data: { ...existingProduct, product_name: 'Bút mực Hồng Hà',
        created_at: existingProduct.created_at.toISOString(), updated_at: '2026-01-03T00:00:00.000Z' } });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[1][1]).toEqual(['SP013']);
    expect(query.mock.calls.some(call => String(call[0]).includes('FROM public.inventory'))).toBe(false);
    expect(query.mock.calls.filter(call => String(call[0]).startsWith('UPDATE'))).toEqual([[
      'UPDATE public.products SET product_name = $2, is_active = $3 WHERE product_id = $1 RETURNING product_id, product_name, base_unit, is_active, created_at, updated_at',
      ['SP013', 'Bút mực Hồng Hà', true],
    ]]);
    expect(query.mock.calls.map(call => String(call[0])).join(' ')).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.(?:inventory|product_units|stock_transactions)/i);
  });

  it('finds SP013 and renames it when inventory is zero', async () => {
    mockProductPatch({ quantity: '0' });
    await request(app.getHttpServer()).patch('/api/products/SP013')
      .set('Authorization', 'Bearer valid-token')
      .send({ product_name: 'Bút mực Hồng Hà' }).expect(200)
      .expect(response => { expect(response.body.data.product_name).toBe('Bút mực Hồng Hà'); });
    expect(query.mock.calls[1][1]).toEqual(['SP013']);
    expect(query.mock.calls.some(call => String(call[0]).includes('FROM public.inventory'))).toBe(false);
  });

  it('returns 404 for an unknown product', async () => {
    mockProductPatch({ product: null });
    await request(app.getHttpServer()).patch('/api/products/SP013')
      .set('Authorization', 'Bearer valid-token').send({ is_active: false }).expect(404);
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE'))).toBe(false);
  });

  it('rejects deactivation with stock and leaves the name unchanged', async () => {
    const current = mockProductPatch({ quantity: '240' });
    const response = await request(app.getHttpServer()).patch('/api/products/SP013')
      .set('Authorization', 'Bearer valid-token')
      .send({ product_name: 'Changed', is_active: false }).expect(409);
    expect(response.body.message).toBe('Không thể ngừng hoạt động sản phẩm khi vẫn còn tồn kho.');
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE'))).toBe(false);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(current()).toEqual(existingProduct);
  });

  it('deactivates at zero stock after locking products then inventory', async () => {
    mockProductPatch({ quantity: '0' });
    await request(app.getHttpServer()).patch('/api/products/SP013')
      .set('Authorization', 'Bearer valid-token').send({ is_active: false }).expect(200)
      .expect(response => { expect(response.body.data.is_active).toBe(false); });
    expect(query.mock.calls.slice(1, 4).map(call => String(call[0]).split(' ')[0])).toEqual(['SELECT', 'SELECT', 'UPDATE']);
    expect(String(query.mock.calls[1][0])).toContain('FROM public.products WHERE product_id = $1 FOR UPDATE');
    expect(String(query.mock.calls[2][0])).toContain('FROM public.inventory WHERE product_id = $1 FOR UPDATE');
  });

  it('reactivates and avoids a second UPDATE for an unchanged status', async () => {
    mockProductPatch({ product: { ...existingProduct, is_active: false }, quantity: '0' });
    await request(app.getHttpServer()).patch('/api/products/SP013')
      .set('Authorization', 'Bearer valid-token').send({ is_active: true }).expect(200)
      .expect(response => { expect(response.body.data.is_active).toBe(true); });
    query.mockClear();
    mockProductPatch({ product: existingProduct });
    await request(app.getHttpServer()).patch('/api/products/SP013')
      .set('Authorization', 'Bearer valid-token').send({ is_active: true }).expect(200)
      .expect(response => { expect(response.body.data.updated_at).toBe(existingProduct.updated_at.toISOString()); });
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE'))).toBe(false);
  });

  it('treats repeated deactivation as a no-op without changing updated_at', async () => {
    mockProductPatch({ product: { ...existingProduct, is_active: false }, quantity: '0' });
    await request(app.getHttpServer()).patch('/api/products/SP013')
      .set('Authorization', 'Bearer valid-token').send({ is_active: false }).expect(200)
      .expect(response => { expect(response.body.data.updated_at).toBe(existingProduct.updated_at.toISOString()); });
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE'))).toBe(false);
  });

  it('updates name and deactivates together after the zero-stock check', async () => {
    mockProductPatch({ quantity: '0' });
    await request(app.getHttpServer()).patch('/api/products/SP013')
      .set('Authorization', 'Bearer valid-token')
      .send({ product_name: 'Bút mực Hồng Hà', is_active: false }).expect(200)
      .expect(response => {
        expect(response.body.data.product_name).toBe('Bút mực Hồng Hà');
        expect(response.body.data.is_active).toBe(false);
        expect(response.body.data.updated_at).toBe('2026-01-03T00:00:00.000Z');
      });
    expect(query.mock.calls.filter(call => String(call[0]).startsWith('UPDATE'))).toHaveLength(1);
  });

  it('returns a safe conflict when inventory is missing before deactivation', async () => {
    mockProductPatch({ quantity: null });
    const response = await request(app.getHttpServer()).patch('/api/products/SP013')
      .set('Authorization', 'Bearer valid-token').send({ is_active: false }).expect(409);
    expect(response.body.message).toBe('Inventory record missing');
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE'))).toBe(false);
  });

  it('hides database errors from PATCH response', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes('FROM public.users')) return [businessUser];
      throw new Error('secret connection string');
    });
    const response = await request(app.getHttpServer()).patch('/api/products/SP013')
      .set('Authorization', 'Bearer valid-token').send({ is_active: false }).expect(500);
    expect(JSON.stringify(response.body)).not.toContain('secret connection string');
  });

  it('documents PATCH product DTO, bearer auth and errors', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
    const patch = document.paths['/api/products/{id}']?.patch;
    expect(patch?.security).toEqual([{ bearer: [] }]);
    expect(patch?.requestBody).toBeDefined();
    for (const status of ['200', '400', '401', '403', '404', '409']) {
      expect(patch?.responses?.[status]).toBeDefined();
    }
  });

  const unitBody = {
    product_id: 'SP013', unit_name: 'box', conversion_factor: 20,
    scan_code: 'SW-SP013-20', is_base_unit: false,
  };
  const unitProduct = { product_name: 'Product 13', base_unit: 'piece', is_active: true };
  const unitRow = {
    product_unit_id: '9007199254740993', product_id: 'SP013', unit_name: 'box',
    conversion_factor: 20, scan_code: 'SW-SP013-20', is_base_unit: false,
    created_at: new Date('2026-01-02T00:00:00.000Z'),
  };

  function mockUnitQueries(options: { product?: object | null; conflicts?: object; insertError?: object } = {}) {
    query.mockImplementation((sql: string) => {
      if (sql.includes('FROM public.users')) return [businessUser];
      if (sql.includes('FROM public.products WHERE')) return options.product === null ? [] : [options.product ?? unitProduct];
      if (sql.includes('SELECT EXISTS')) return [options.conflicts ?? {
        scan_code_exists: false, unit_name_exists: false, base_unit_exists: false,
      }];
      if (sql.startsWith('INSERT INTO public.product_units')) {
        if (options.insertError) throw Object.assign(new Error('secret SQL'), options.insertError);
        return [unitRow];
      }
      throw new Error('Unexpected SQL');
    });
  }

  it('requires JWT and ADMIN for POST /api/product-units', async () => {
    await request(app.getHttpServer()).post('/api/product-units').send(unitBody).expect(401);
    expect(query).not.toHaveBeenCalled();
    for (const role of ['STAFF', 'VIEWER']) {
      query.mockResolvedValue([{ ...businessUser, role }]);
      await request(app.getHttpServer()).post('/api/product-units')
        .set('Authorization', 'Bearer valid-token').send(unitBody).expect(403);
      expect(query).toHaveBeenCalledTimes(role === 'STAFF' ? 1 : 2);
    }
  });

  it('creates a unit with trimmed strings and touches only product_units', async () => {
    mockUnitQueries();
    await request(app.getHttpServer()).post('/api/product-units')
      .set('Authorization', 'Bearer valid-token')
      .send({ ...unitBody, product_id: ' SP013 ', unit_name: ' box ', scan_code: ' SW-SP013-20 ' })
      .expect(201).expect({ data: {
        ...unitRow, product_name: unitProduct.product_name,
        created_at: unitRow.created_at.toISOString(),
      } });
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[3][0]).toMatch(/^INSERT INTO public\.product_units /);
    expect(query.mock.calls[3][1]).toEqual(['SP013', 'box', 20, 'SW-SP013-20', false]);
    expect(query.mock.calls.map(call => call[0]).join(' ')).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.(?:inventory|stock_transactions)/i);
  });

  it.each([
    { ...unitBody, unit_name: ' ' },
    { ...unitBody, product_id: '' },
    { ...unitBody, scan_code: '' },
    { ...unitBody, conversion_factor: 0 },
    { ...unitBody, conversion_factor: 1.5 },
    { ...unitBody, conversion_factor: 2147483648 },
    { ...unitBody, is_base_unit: 'false' },
    { ...unitBody, unit_name: 'x'.repeat(31) },
    { ...unitBody, scan_code: 'x'.repeat(81) },
    { ...unitBody, product_unit_id: '2' },
    { ...unitBody, created_at: '2026-01-01' },
  ])('rejects invalid unit DTO: %j', async body => {
    await request(app.getHttpServer()).post('/api/product-units')
      .set('Authorization', 'Bearer valid-token').send(body).expect(400);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for unknown product and 409 for inactive product', async () => {
    mockUnitQueries({ product: null });
    await request(app.getHttpServer()).post('/api/product-units')
      .set('Authorization', 'Bearer valid-token').send(unitBody).expect(404);
    mockUnitQueries({ product: { ...unitProduct, is_active: false } });
    await request(app.getHttpServer()).post('/api/product-units')
      .set('Authorization', 'Bearer valid-token').send(unitBody).expect(409);
  });

  it('validates the base unit factor and name', async () => {
    await request(app.getHttpServer()).post('/api/product-units')
      .set('Authorization', 'Bearer valid-token')
      .send({ ...unitBody, is_base_unit: true }).expect(400);
    mockUnitQueries();
    await request(app.getHttpServer()).post('/api/product-units')
      .set('Authorization', 'Bearer valid-token')
      .send({ ...unitBody, is_base_unit: true, conversion_factor: 1 }).expect(400);
    expect(query.mock.calls.some(call => String(call[0]).startsWith('INSERT'))).toBe(false);
  });

  it.each([
    ['scan_code_exists', 'Scan code already exists'],
    ['unit_name_exists', 'Unit name already exists for this product'],
    ['base_unit_exists', 'Base unit already exists for this product'],
  ])('rejects existing %s before inserting', async (flag, message) => {
    mockUnitQueries({ conflicts: { [flag]: true } });
    const body = flag === 'base_unit_exists'
      ? { ...unitBody, unit_name: 'piece', conversion_factor: 1, is_base_unit: true }
      : unitBody;
    const response = await request(app.getHttpServer()).post('/api/product-units')
      .set('Authorization', 'Bearer valid-token').send(body).expect(409);
    expect(response.body.message).toBe(message);
    expect(query.mock.calls.some(call => String(call[0]).startsWith('INSERT'))).toBe(false);
  });

  it.each([
    ['23505', 'product_units_scan_code_key', 409],
    ['23505', 'uq_product_unit', 409],
    ['23505', 'uq_one_base_unit_per_product', 409],
    ['23503', 'product_units_product_id_fkey', 404],
    ['23514', 'ck_base_unit_factor', 400],
  ])('maps PostgreSQL %s constraint %s to HTTP %i without SQL details', async (code, constraint_name, status) => {
    mockUnitQueries({ insertError: { code, constraint_name } });
    const response = await request(app.getHttpServer()).post('/api/product-units')
      .set('Authorization', 'Bearer valid-token').send(unitBody).expect(status);
    expect(JSON.stringify(response.body)).not.toContain('secret SQL');
  });

  it('documents POST /api/product-units DTO, auth, and errors', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
    const post = document.paths['/api/product-units']?.post;
    expect(post?.security).toEqual([{ bearer: [] }]);
    expect(post?.requestBody).toBeDefined();
    for (const status of ['201', '400', '401', '403', '404', '409']) {
      expect(post?.responses?.[status]).toBeDefined();
    }
  });

  function mockUnitPatch(options: {
    unit?: typeof unitRow | null; quantity?: string | null; history?: boolean;
    nameConflict?: boolean; codeConflict?: boolean; updateError?: object;
    productUpdateError?: object; baseUnit?: string;
  } = {}) {
    let current = options.unit === undefined ? { ...unitRow } : options.unit && { ...options.unit };
    let product = { product_name: 'Product 13', base_unit: options.baseUnit ?? current?.unit_name.trim() ?? 'piece' };
    transaction.mockImplementation(async (work: (execute: typeof query) => Promise<unknown>) => {
      const unitBefore = current && { ...current };
      const productBefore = { ...product };
      try { return await work(query); }
      catch (error) { current = unitBefore; product = productBefore; throw error; }
    });
    query.mockImplementation((sql: string, parameters?: unknown[]) => {
      if (sql.includes('FROM public.users')) return [businessUser];
      if (sql.startsWith('SELECT product_id FROM public.product_units')) {
        return current && parameters?.[0] === current.product_unit_id ? [{ product_id: current.product_id }] : [];
      }
      if (sql.includes('FROM public.products WHERE') && sql.includes('FOR UPDATE')) return [{ ...product }];
      if (sql.includes('FROM public.inventory WHERE') && sql.includes('FOR UPDATE')) {
        return options.quantity === null ? [] : [{ quantity_base: options.quantity ?? '0' }];
      }
      if (sql.includes('FROM public.product_units WHERE') && sql.includes('FOR UPDATE')) return current ? [{ ...current }] : [];
      if (sql.includes('FROM public.stock_transactions')) return [{ has_transactions: options.history ?? false }];
      if (sql.startsWith('SELECT EXISTS') && sql.includes('unit_name_exists')) {
        return [{ unit_name_exists: options.nameConflict ?? false, scan_code_exists: options.codeConflict ?? false }];
      }
      if (sql.startsWith('UPDATE public.products')) {
        if (options.productUpdateError) throw Object.assign(new Error('secret SQL'), options.productUpdateError);
        product = { ...product, base_unit: parameters![1] as string };
        return [{ base_unit: product.base_unit }];
      }
      if (sql.startsWith('UPDATE public.product_units')) {
        if (options.updateError) throw Object.assign(new Error('secret SQL'), options.updateError);
        current = { ...current!, unit_name: parameters![1] as string, scan_code: parameters![2] as string,
          conversion_factor: parameters![3] as number };
        return [{ ...current }];
      }
      throw new Error('Unexpected SQL');
    });
    return Object.assign(() => current, { product: () => product });
  }

  const patchUnitId = unitRow.product_unit_id;
  const patchUnit = (body: object, id = patchUnitId) => request(app.getHttpServer())
    .patch(`/api/product-units/${id}`).set('Authorization', 'Bearer valid-token').send(body);

  it('requires JWT and ADMIN to patch a unit', async () => {
    await request(app.getHttpServer()).patch(`/api/product-units/${patchUnitId}`)
      .send({ unit_name: 'carton' }).expect(401);
    for (const role of ['STAFF', 'VIEWER']) {
      query.mockResolvedValue([{ ...businessUser, role }]);
      await patchUnit({ unit_name: 'carton' }).expect(403);
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    {}, { unit_name: ' ' }, { unit_name: null }, { unit_name: 5 }, { unit_name: 'x'.repeat(31) },
    { scan_code: '   ' }, { scan_code: null }, { scan_code: 'x'.repeat(81) },
    { conversion_factor: 0 }, { conversion_factor: 1.5 }, { conversion_factor: 2147483648 },
    { conversion_factor: '20' }, { conversion_factor: null }, { conversion_factor: true },
    { product_unit_id: '2' }, { product_id: 'SP014' }, { is_base_unit: true },
    { created_at: '2026-01-01' }, { quantity_base: '0' }, { inventory_after: '0' },
    { conversion_factor_snapshot: 20 }, { scan_code_snapshot: 'old' },
  ])('rejects invalid unit PATCH body %j', async body => {
    await patchUnit(body).expect(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', '12x', '1.5', '9223372036854775808'])('rejects invalid BIGINT unit ID %s', async id => {
    await patchUnit({ unit_name: 'carton' }, id).expect(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('renames a unit with stock and history without touching inventory or transactions', async () => {
    const current = mockUnitPatch({ quantity: '240', history: true });
    await patchUnit({ unit_name: '  Hộp lớn  ' }).expect(200)
      .expect(response => {
        expect(response.body.data.product_unit_id).toBe(patchUnitId);
        expect(response.body.data.unit_name).toBe('Hộp lớn');
        expect(response.body.data.conversion_factor).toBe(20);
      });
    expect(current()?.unit_name).toBe('Hộp lớn');
    expect(query.mock.calls.some(call => String(call[0]).includes('FROM public.inventory'))).toBe(false);
    expect(query.mock.calls.some(call => String(call[0]).includes('FROM public.stock_transactions'))).toBe(false);
    expect(query.mock.calls.map(call => String(call[0])).join(' ')).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.(?:inventory|stock_transactions)/i);
  });

  it('changes a scan code with history without rewriting snapshots or factor', async () => {
    mockUnitPatch({ history: true, quantity: '10' });
    await patchUnit({ scan_code: ' SW-SP013-BOX ' }).expect(200)
      .expect(response => {
        expect(response.body.data.scan_code).toBe('SW-SP013-BOX');
        expect(response.body.data.conversion_factor).toBe(20);
      });
    expect(query.mock.calls.some(call => String(call[0]).includes('FROM public.stock_transactions'))).toBe(false);
    expect(query.mock.calls.map(call => String(call[0])).join(' ')).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.(?:inventory|stock_transactions)/i);
  });

  it('changes factor only after locking product, inventory, unit and checking history', async () => {
    mockUnitPatch({ quantity: '0', history: false });
    await patchUnit({ conversion_factor: 120 }).expect(200)
      .expect(response => { expect(response.body.data.conversion_factor).toBe(120); });
    const sql = query.mock.calls.map(call => String(call[0]));
    expect(sql.findIndex(statement => statement.includes('FROM public.products') && statement.includes('FOR UPDATE')))
      .toBeLessThan(sql.findIndex(statement => statement.includes('FROM public.inventory') && statement.includes('FOR UPDATE')));
    expect(sql.findIndex(statement => statement.includes('FROM public.inventory') && statement.includes('FOR UPDATE')))
      .toBeLessThan(sql.findIndex(statement => statement.includes('FROM public.product_units') && statement.includes('FOR UPDATE')));
    expect(sql.findIndex(statement => statement.includes('FROM public.stock_transactions')))
      .toBeLessThan(sql.findIndex(statement => statement.startsWith('UPDATE public.product_units')));
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(sql.join(' ')).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.(?:inventory|stock_transactions)/i);
  });

  it.each([
    [{ history: true, quantity: '0' }, 'đã phát sinh giao dịch'],
    [{ history: false, quantity: '240' }, 'vẫn còn tồn kho'],
    [{ history: false, quantity: null }, 'Inventory record missing'],
  ] as const)('rejects unsafe factor change %j', async (options, message) => {
    const current = mockUnitPatch(options);
    const response = await patchUnit({ unit_name: 'carton', conversion_factor: 120 }).expect(409);
    expect(response.body.message).toContain(message);
    expect(current()).toEqual(unitRow);
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE public.product_units'))).toBe(false);
  });

  it('rejects changing the base factor but permits a normalized same-name no-op', async () => {
    mockUnitPatch({ unit: { ...unitRow, is_base_unit: true, conversion_factor: 1 } });
    await patchUnit({ conversion_factor: 2 }).expect(409);
    query.mockClear();
    mockUnitPatch({ unit: { ...unitRow, is_base_unit: true, conversion_factor: 1 }, history: true, quantity: '240' });
    await patchUnit({ unit_name: ' box ', conversion_factor: 1 }).expect(200);
    expect(query.mock.calls.some(call => String(call[0]).includes('FROM public.stock_transactions'))).toBe(false);
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE'))).toBe(false);
  });

  it('renames a base unit and its product together without changing stock or history', async () => {
    const original = { ...unitRow, unit_name: 'Cây\n', is_base_unit: true, conversion_factor: 1 };
    const current = mockUnitPatch({ unit: original });
    await patchUnit({ unit_name: ' Chiếc ' }).expect(200).expect(response => {
      expect(response.body.data).toMatchObject({ product_unit_id: patchUnitId, product_id: 'SP013',
        unit_name: 'Chiếc', conversion_factor: 1, is_base_unit: true, scan_code: original.scan_code });
    });
    expect(current()?.unit_name).toBe('Chiếc');
    expect(current.product().base_unit).toBe('Chiếc');
    const sql = query.mock.calls.map(call => String(call[0]));
    expect(sql.findIndex(statement => statement.includes('FROM public.products') && statement.includes('FOR UPDATE')))
      .toBeLessThan(sql.findIndex(statement => statement.includes('FROM public.product_units') && statement.includes('FOR UPDATE')));
    expect(sql.filter(statement => statement.startsWith('UPDATE'))).toEqual([
      'UPDATE public.products SET base_unit = $2 WHERE product_id = $1 RETURNING base_unit',
      'UPDATE public.product_units SET unit_name = $2, scan_code = $3, conversion_factor = $4 WHERE product_unit_id = $1 RETURNING product_unit_id, product_id, unit_name, conversion_factor, scan_code, is_base_unit, created_at',
    ]);
    expect(sql.join(' ')).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.(?:inventory|stock_transactions)/i);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('normalizes a legacy whitespace mismatch only when ADMIN submits the name', async () => {
    const original = { ...unitRow, unit_name: 'Cây\n', is_base_unit: true, conversion_factor: 1 };
    const current = mockUnitPatch({ unit: original, baseUnit: 'Cây' });
    await patchUnit({ scan_code: 'NEW-CODE' }).expect(409);
    expect(current()).toEqual(original);
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE'))).toBe(false);
    query.mockClear();
    await patchUnit({ unit_name: ' Cây ' }).expect(200);
    expect(current()?.unit_name).toBe('Cây');
    expect(current.product().base_unit).toBe('Cây');
    expect(query.mock.calls.filter(call => String(call[0]).startsWith('UPDATE public.product_units'))).toHaveLength(1);
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE public.products'))).toBe(false);
  });

  it('does not update either table when the base names already match exactly', async () => {
    const original = { ...unitRow, unit_name: 'Cây', is_base_unit: true, conversion_factor: 1 };
    const current = mockUnitPatch({ unit: original, baseUnit: 'Cây' });
    await patchUnit({ unit_name: ' Cây ' }).expect(200);
    expect(current()).toEqual(original);
    expect(current.product().base_unit).toBe('Cây');
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE'))).toBe(false);
  });

  it('rejects inconsistent existing base unit names without changing either table', async () => {
    const original = { ...unitRow, unit_name: 'Cây', is_base_unit: true, conversion_factor: 1 };
    const current = mockUnitPatch({ unit: original, baseUnit: 'Hộp' });
    const response = await patchUnit({ unit_name: 'Chiếc' }).expect(409);
    expect(response.body.message).toBe('Tên đơn vị cơ sở hiện không khớp với sản phẩm. Cần kiểm tra dữ liệu trước khi chỉnh sửa.');
    expect(current()).toEqual(original);
    expect(current.product().base_unit).toBe('Hộp');
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE'))).toBe(false);
  });

  it('rejects a duplicate base unit name before changing either table', async () => {
    const original = { ...unitRow, unit_name: 'Cây', is_base_unit: true, conversion_factor: 1 };
    const current = mockUnitPatch({ unit: original, nameConflict: true });
    await patchUnit({ unit_name: 'Chiếc' }).expect(409);
    expect(current()).toEqual(original);
    expect(current.product().base_unit).toBe('Cây');
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE'))).toBe(false);
  });

  it('rolls back a base rename when updating the unit fails after updating the product', async () => {
    const original = { ...unitRow, unit_name: 'Cây', is_base_unit: true, conversion_factor: 1 };
    const current = mockUnitPatch({ unit: original,
      updateError: { code: '23505', constraint_name: 'product_units_scan_code_key' } });
    await patchUnit({ unit_name: 'Chiếc', scan_code: 'TAKEN' }).expect(409);
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE public.products'))).toBe(true);
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE public.product_units'))).toBe(true);
    expect(current()).toEqual(original);
    expect(current.product().base_unit).toBe('Cây');
  });

  it('does not update the unit when the product base unit update fails', async () => {
    const original = { ...unitRow, unit_name: 'Cây', is_base_unit: true, conversion_factor: 1 };
    const current = mockUnitPatch({ unit: original, productUpdateError: {} });
    await patchUnit({ unit_name: 'Chiếc' }).expect(500);
    expect(current()).toEqual(original);
    expect(current.product().base_unit).toBe('Cây');
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE public.product_units'))).toBe(false);
  });

  it('updates a base name and scan code atomically', async () => {
    const original = { ...unitRow, unit_name: 'Cây', is_base_unit: true, conversion_factor: 1 };
    const current = mockUnitPatch({ unit: original });
    await patchUnit({ unit_name: 'Chiếc', scan_code: 'SW-SP013-NEW' }).expect(200);
    expect(current()).toMatchObject({ unit_name: 'Chiếc', scan_code: 'SW-SP013-NEW', conversion_factor: 1 });
    expect(current.product().base_unit).toBe('Chiếc');
  });

  it('keeps product and base unit names aligned across concurrent requests', async () => {
    const original = { ...unitRow, unit_name: 'Cây', is_base_unit: true, conversion_factor: 1 };
    const current = mockUnitPatch({ unit: original });
    let previous: Promise<unknown> = Promise.resolve();
    transaction.mockImplementation((work: (execute: typeof query) => Promise<unknown>) => {
      const pending = previous.then(() => work(query));
      previous = pending.catch(() => undefined);
      return pending;
    });
    await Promise.all([
      patchUnit({ unit_name: 'Chiếc' }).expect(200),
      patchUnit({ unit_name: 'Cái' }).expect(200),
    ]);
    expect(current.product().base_unit).toBe(current()?.unit_name);
    expect(query.mock.calls.filter(call => String(call[0]).startsWith('UPDATE public.products'))).toHaveLength(2);
    expect(query.mock.calls.filter(call => String(call[0]).startsWith('UPDATE public.product_units'))).toHaveLength(2);
  });

  it('allows a base unit scan code update while preserving its existing name and factor', async () => {
    const original = { ...unitRow, unit_name: 'Cây\n', is_base_unit: true, conversion_factor: 1 };
    mockUnitPatch({ unit: original, history: true, quantity: '240' });
    await patchUnit({ unit_name: 'Cây', scan_code: 'SW-SP013-BASE-NEW' }).expect(200)
      .expect(response => {
        expect(response.body.data.unit_name).toBe('Cây');
        expect(response.body.data.conversion_factor).toBe(1);
        expect(response.body.data.scan_code).toBe('SW-SP013-BASE-NEW');
      });
    expect(query.mock.calls.some(call => String(call[0]).includes('FROM public.inventory'))).toBe(false);
    expect(query.mock.calls.some(call => String(call[0]).includes('FROM public.stock_transactions'))).toBe(false);
    expect(query.mock.calls.map(call => String(call[0])).join(' ')).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.(?:products|inventory|stock_transactions)/i);
  });

  it.each([
    [{ nameConflict: true }, { unit_name: 'carton' }, 'Unit name already exists for this product'],
    [{ codeConflict: true }, { scan_code: 'TAKEN' }, 'Scan code already exists'],
  ] as const)('rejects duplicate unit field %j', async (options, body, message) => {
    mockUnitPatch(options);
    const response = await patchUnit(body).expect(409);
    expect(response.body.message).toBe(message);
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE public.product_units'))).toBe(false);
  });

  it.each([
    ['product_units_scan_code_key', 'Scan code already exists'],
    ['uq_product_unit', 'Unit name already exists for this product'],
  ])('maps concurrent unique violation %s to 409', async (constraint_name, message) => {
    mockUnitPatch({ updateError: { code: '23505', constraint_name } });
    const response = await patchUnit({ scan_code: 'NEW' }).expect(409);
    expect(response.body.message).toBe(message);
    expect(JSON.stringify(response.body)).not.toContain('secret SQL');
  });

  it('returns 404 for an unknown unit and does not update another record', async () => {
    mockUnitPatch({ unit: null });
    await patchUnit({ unit_name: 'carton' }).expect(404);
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE public.product_units'))).toBe(false);
  });

  it('treats an unchanged factor and normalized name as a no-op despite history and stock', async () => {
    mockUnitPatch({ history: true, quantity: '240' });
    await patchUnit({ unit_name: ' BOX ', conversion_factor: 20 }).expect(200);
    await patchUnit({ unit_name: ' BOX ', conversion_factor: 20 }).expect(200);
    expect(query.mock.calls.some(call => String(call[0]).includes('FROM public.stock_transactions'))).toBe(false);
    expect(query.mock.calls.some(call => String(call[0]).startsWith('UPDATE public.product_units'))).toBe(false);
  });

  it('does not expose unexpected database errors', async () => {
    mockUnitPatch({ updateError: {} });
    const response = await patchUnit({ unit_name: 'carton' }).expect(500);
    expect(JSON.stringify(response.body)).not.toContain('secret SQL');
  });

  it('documents PATCH unit DTO, bearer auth and errors', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
    const patch = document.paths['/api/product-units/{id}']?.patch;
    expect(patch?.security).toEqual([{ bearer: [] }]);
    expect(patch?.requestBody).toBeDefined();
    for (const status of ['200', '400', '401', '403', '404', '409', '500']) expect(patch?.responses?.[status]).toBeDefined();
  });

  afterEach(async () => {
    await app.close();
  });
});
