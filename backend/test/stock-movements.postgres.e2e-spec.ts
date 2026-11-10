import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { JwtVerifierService } from '../src/auth/jwt-verifier.service';
import { DatabaseService } from '../src/database/database.service';

const qaUrl = process.env.QA_DATABASE_URL;
const describePostgres = qaUrl ? describe : describe.skip;
const uuid = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
const basePayload = {
  transaction_id: uuid('1'), scan_code: 'BOX-NONNUMERIC',
  scan_point_id: 'SCAN-01', movement_type: 'IN',
};

describePostgres('POST /api/stock-movements with isolated PostgreSQL', () => {
  let app: INestApplication<App>;
  let sql: ReturnType<typeof postgres>;
  const authUsers: Record<string, string> = {
    'admin-token': '00000000-0000-4000-8000-000000000001',
    'staff-token': '00000000-0000-4000-8000-000000000002',
    'viewer-token': '00000000-0000-4000-8000-000000000003',
    'inactive-token': '00000000-0000-4000-8000-000000000004',
    'missing-token': '00000000-0000-4000-8000-000000000099',
  };

  beforeAll(async () => {
    const parsed = new URL(qaUrl!);
    if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' || parsed.pathname !== '/qa_stock') {
      throw new Error('QA_DATABASE_URL must target the isolated local qa_stock database');
    }
    sql = postgres(qaUrl!, { max: 20 });
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS products (
        product_id varchar(20) PRIMARY KEY, product_name varchar(150) NOT NULL,
        base_unit varchar(30) NOT NULL, is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS users (
        user_id bigint PRIMARY KEY, auth_user_id uuid UNIQUE NOT NULL,
        username varchar(50) UNIQUE NOT NULL, display_name varchar(120) NOT NULL,
        role varchar(20) NOT NULL CHECK (role IN ('ADMIN','STAFF','VIEWER')),
        is_active boolean NOT NULL DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS inventory (
        product_id varchar(20) PRIMARY KEY REFERENCES products(product_id),
        quantity_base bigint NOT NULL DEFAULT 0 CHECK (quantity_base >= 0),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS product_units (
        product_unit_id bigint PRIMARY KEY, product_id varchar(20) NOT NULL REFERENCES products(product_id),
        unit_name varchar(30) NOT NULL, conversion_factor integer NOT NULL CHECK (conversion_factor >= 1),
        scan_code varchar(80) UNIQUE NOT NULL, is_base_unit boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_product_unit UNIQUE(product_id, unit_name),
        CONSTRAINT uq_product_unit_product UNIQUE(product_unit_id, product_id),
        CONSTRAINT ck_base_unit_factor CHECK (NOT is_base_unit OR conversion_factor = 1)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_one_base_unit_per_product ON product_units(product_id) WHERE is_base_unit;
      CREATE TABLE IF NOT EXISTS scan_points (
        scan_point_id varchar(20) PRIMARY KEY, point_name varchar(100) NOT NULL,
        is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS stock_transactions (
        transaction_id uuid PRIMARY KEY, product_id varchar(20) NOT NULL REFERENCES products(product_id),
        product_unit_id bigint NOT NULL, scan_point_id varchar(20) NOT NULL REFERENCES scan_points(scan_point_id),
        user_id bigint NOT NULL REFERENCES users(user_id), movement_type varchar(3) NOT NULL CHECK (movement_type IN ('IN','OUT')),
        quantity_packages integer NOT NULL CHECK (quantity_packages > 0),
        conversion_factor_snapshot integer NOT NULL CHECK (conversion_factor_snapshot > 0),
        quantity_base bigint GENERATED ALWAYS AS (quantity_packages::bigint * conversion_factor_snapshot::bigint) STORED,
        inventory_before bigint NOT NULL CHECK (inventory_before >= 0), inventory_after bigint NOT NULL CHECK (inventory_after >= 0),
        scan_code_snapshot varchar(80) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_stock_unit_product FOREIGN KEY(product_unit_id, product_id)
          REFERENCES product_units(product_unit_id, product_id),
        CONSTRAINT ck_stock_inventory_math CHECK (
          (movement_type = 'IN' AND inventory_after = inventory_before + quantity_base) OR
          (movement_type = 'OUT' AND inventory_after = inventory_before - quantity_base)
        )
      );
      CREATE OR REPLACE FUNCTION qa_fail_inventory_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.product_id = 'PFAIL' THEN RAISE EXCEPTION 'QA forced inventory failure'; END IF; RETURN NEW; END $$;
      DROP TRIGGER IF EXISTS qa_fail_inventory ON inventory;
      CREATE TRIGGER qa_fail_inventory BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION qa_fail_inventory_update();
      CREATE OR REPLACE FUNCTION qa_fail_history_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.transaction_id = '10000000-0000-4000-8000-000000009999'::uuid THEN RAISE EXCEPTION 'QA forced history failure'; END IF; RETURN NEW; END $$;
      DROP TRIGGER IF EXISTS qa_fail_history ON stock_transactions;
      CREATE TRIGGER qa_fail_history BEFORE INSERT ON stock_transactions FOR EACH ROW EXECUTE FUNCTION qa_fail_history_insert();
    `);

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({
        query: (text: string, parameters: (string | number | boolean | null)[] = []) => sql.unsafe(text, parameters),
        transaction: <T>(work: (query: (text: string, parameters?: (string | number | boolean | null)[]) => Promise<Record<string, unknown>[]>) => Promise<T>) =>
          sql.begin(async transaction => work((text, parameters = []) => transaction.unsafe(text, parameters) as unknown as Promise<Record<string, unknown>[]>)),
        checkHealth: () => sql.unsafe('SELECT 1'),
      })
      .overrideProvider(JwtVerifierService)
      .useValue({ verify: async (token: string) => {
        const authId = authUsers[token];
        if (!authId) throw new Error('invalid token');
        return authId;
      } }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  beforeEach(async () => {
    await sql.unsafe('TRUNCATE stock_transactions, product_units, inventory, scan_points, users, products CASCADE');
    await sql.unsafe(`
      INSERT INTO users(user_id,auth_user_id,username,display_name,role,is_active) VALUES
        (1,'00000000-0000-4000-8000-000000000001','admin','Admin','ADMIN',true),
        (2,'00000000-0000-4000-8000-000000000002','staff','Staff','STAFF',true),
        (3,'00000000-0000-4000-8000-000000000003','viewer','Viewer','VIEWER',true),
        (4,'00000000-0000-4000-8000-000000000004','inactive','Inactive','STAFF',false);
      INSERT INTO products(product_id,product_name,base_unit,is_active) VALUES
        ('P1','QA Product','piece',true), ('PLOCK','QA Lock Product','piece',true),
        ('PINACTIVE','QA Inactive','piece',false), ('PMISSING','QA Missing Inventory','piece',true),
        ('POVERFLOW','QA Overflow','piece',true), ('PFAIL','QA Update Failure','piece',true);
      INSERT INTO inventory(product_id,quantity_base) VALUES
        ('P1',100),('PLOCK',0),('PINACTIVE',0),('POVERFLOW',9223372036854775807),('PFAIL',0);
      INSERT INTO product_units(product_unit_id,product_id,unit_name,conversion_factor,scan_code,is_base_unit) VALUES
        (1,'P1','piece',1,'ODD-BASE-X',true), (2,'P1','box',24,'BOX-NONNUMERIC',false),
        (3,'PLOCK','lock-box',24,'LOCK-BOX',false), (4,'PINACTIVE','inactive-box',5,'INACTIVE-BOX',false),
        (5,'PMISSING','missing-box',5,'MISSING-BOX',false), (6,'POVERFLOW','overflow-piece',1,'OVERFLOW-X',true),
        (7,'PFAIL','fail-piece',1,'FAIL-X',true);
      INSERT INTO scan_points(scan_point_id,point_name,is_active) VALUES
        ('SCAN-01','Gate 1',true),('SCAN-02','Gate 2',true),('SCAN-OFF','Offline Gate',false);
    `);
  });

  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  const post = (body: object = basePayload, token = 'admin-token') => request(app.getHttpServer())
    .post('/api/stock-movements').set('Authorization', `Bearer ${token}`).send(body);
  const patchProduct = (id: string, body: object) => request(app.getHttpServer())
    .patch(`/api/products/${id}`).set('Authorization', 'Bearer admin-token').send(body);
  const patchUnit = (id: string, body: object) => request(app.getHttpServer())
    .patch(`/api/product-units/${id}`).set('Authorization', 'Bearer admin-token').send(body);

  it('commits factor 1 and factor 24 movements with exact snapshots and authenticated users', async () => {
    const one = await post({ ...basePayload, transaction_id: uuid('10'), scan_code: 'ODD-BASE-X' }).expect(201);
    expect(one.body.data).toMatchObject({ quantity_packages: 1, conversion_factor_snapshot: 1,
      quantity_base: '1', inventory_before: '100', inventory_after: '101', user_id: '1' });
    const box = await post({ ...basePayload, transaction_id: uuid('11') }, 'staff-token').expect(201);
    expect(box.body.data).toMatchObject({ product_id: 'P1', product_unit_id: '2', scan_point_id: 'SCAN-01',
      quantity_packages: 1, conversion_factor_snapshot: 24, quantity_base: '24',
      inventory_before: '101', inventory_after: '125', scan_code_snapshot: 'BOX-NONNUMERIC', user_id: '2' });
    const [inventory] = await sql.unsafe('SELECT quantity_base FROM inventory WHERE product_id=$1', ['P1']);
    const rows = await sql.unsafe('SELECT * FROM stock_transactions ORDER BY created_at');
    expect(String(inventory.quantity_base)).toBe('125');
    expect(rows).toHaveLength(2);
  });

  it('validates DTO, authentication, authorization and references without database writes', async () => {
    await request(app.getHttpServer()).post('/api/stock-movements').send(basePayload).expect(401);
    await post(basePayload, 'invalid-token').expect(401);
    await post(basePayload, 'viewer-token').expect(403);
    await post(basePayload, 'inactive-token').expect(403);
    await post(basePayload, 'missing-token').expect(403);
    const invalidBodies = [
      {}, { ...basePayload, transaction_id: undefined }, { ...basePayload, transaction_id: 'bad' },
      { ...basePayload, scan_code: undefined }, { ...basePayload, scan_code: '' }, { ...basePayload, scan_code: '   ' },
      { ...basePayload, scan_point_id: undefined }, { ...basePayload, movement_type: 'OUT' },
      { ...basePayload, movement_type: 'MOVE' }, { ...basePayload, quantity_base: '24' },
      { ...basePayload, user_id: '1' }, { ...basePayload, conversion_factor: 24 },
      { ...basePayload, inventory_after: '124' }, { ...basePayload, unknown: true },
      { ...basePayload, scan_code: 123 }, { ...basePayload, scan_code: 'X'.repeat(81) },
    ];
    for (const body of invalidBodies) await post(body).expect(400);
    await post({ ...basePayload, transaction_id: uuid('20'), scan_code: 'UNKNOWN' }).expect(404);
    await post({ ...basePayload, transaction_id: uuid('21'), scan_point_id: 'UNKNOWN' }).expect(404);
    await post({ ...basePayload, transaction_id: uuid('22'), scan_point_id: 'SCAN-OFF' }).expect(409);
    await post({ ...basePayload, transaction_id: uuid('23'), scan_code: 'INACTIVE-BOX' }).expect(409);
    await post({ ...basePayload, transaction_id: uuid('24'), scan_code: 'MISSING-BOX' }).expect(409);
    const [state] = await sql.unsafe("SELECT (SELECT quantity_base FROM inventory WHERE product_id='P1') quantity, (SELECT count(*) FROM stock_transactions) count");
    expect(String(state.quantity)).toBe('100');
    expect(String(state.count)).toBe('0');
  });

  it('replays exact UUID once and rejects changed code, point or authenticated user', async () => {
    const id = uuid('30');
    const created = await post({ ...basePayload, transaction_id: id }).expect(201);
    await sql.unsafe("UPDATE inventory SET quantity_base=999 WHERE product_id='P1'");
    await sql.unsafe("UPDATE products SET product_name='Renamed',is_active=false WHERE product_id='P1'");
    await sql.unsafe("UPDATE product_units SET scan_code='RENAMED-CODE' WHERE product_unit_id=2");
    const replay = await post({ ...basePayload, transaction_id: id }).expect(200);
    expect(replay.body.data.transaction_id).toBe(id);
    expect(replay.body.data.inventory_before).toBe(created.body.data.inventory_before);
    expect(replay.body.data.inventory_after).toBe(created.body.data.inventory_after);
    await post({ ...basePayload, transaction_id: id, scan_code: 'ODD-BASE-X' }).expect(409);
    await post({ ...basePayload, transaction_id: id, scan_point_id: 'SCAN-02' }).expect(409);
    await post({ ...basePayload, transaction_id: id }, 'staff-token').expect(409);
    const [state] = await sql.unsafe('SELECT count(*) count FROM stock_transactions WHERE transaction_id=$1', [id]);
    expect(String(state.count)).toBe('1');
    const [inventory] = await sql.unsafe("SELECT quantity_base FROM inventory WHERE product_id='P1'");
    expect(String(inventory.quantity_base)).toBe('999');
  });

  it('serializes concurrent identical UUID and commits inventory only once', async () => {
    const body = { ...basePayload, transaction_id: uuid('40') };
    const results = await Promise.all([post(body), post(body)]);
    expect(results.map(row => row.status).sort((left, right) => left - right)).toEqual([200, 201]);
    const [state] = await sql.unsafe("SELECT (SELECT quantity_base FROM inventory WHERE product_id='P1') quantity, (SELECT count(*) FROM stock_transactions) count");
    expect(String(state.quantity)).toBe('124');
    expect(String(state.count)).toBe('1');
  });

  it('prevents lost updates for different UUIDs and two scan points', async () => {
    const results = await Promise.all([
      post({ ...basePayload, transaction_id: uuid('50'), scan_point_id: 'SCAN-01' }),
      post({ ...basePayload, transaction_id: uuid('51'), scan_point_id: 'SCAN-02' }),
    ]);
    expect(results.map(row => row.status)).toEqual([201, 201]);
    const [state] = await sql.unsafe("SELECT (SELECT quantity_base FROM inventory WHERE product_id='P1') quantity, (SELECT count(*) FROM stock_transactions) count");
    expect(String(state.quantity)).toBe('148');
    expect(String(state.count)).toBe('2');
  });

  it('rolls back both sides when inventory update or history insert fails, and on overflow', async () => {
    const updateFailure = await post({ ...basePayload, transaction_id: uuid('60'), scan_code: 'FAIL-X' }).expect(500);
    const insertFailure = await post({ ...basePayload, transaction_id: uuid('9999') }).expect(500);
    expect(JSON.stringify(updateFailure.body)).not.toContain('QA forced');
    expect(JSON.stringify(insertFailure.body)).not.toContain('QA forced');
    await post({ ...basePayload, transaction_id: uuid('61'), scan_code: 'OVERFLOW-X' }).expect(409);
    const rows = await sql.unsafe("SELECT product_id,quantity_base FROM inventory WHERE product_id IN ('P1','PFAIL','POVERFLOW') ORDER BY product_id");
    expect(rows.map(row => [row.product_id, String(row.quantity_base)])).toEqual([
      ['P1','100'],['PFAIL','0'],['POVERFLOW','9223372036854775807'],
    ]);
    const [count] = await sql.unsafe('SELECT count(*) count FROM stock_transactions');
    expect(String(count.count)).toBe('0');
  });

  it('uses consistent locking with concurrent factor patch and stock movement without deadlock', async () => {
    const [movement, patch] = await Promise.all([
      post({ ...basePayload, transaction_id: uuid('70'), scan_code: 'LOCK-BOX' }),
      patchUnit('3', { conversion_factor: 5 }),
    ]);
    expect(movement.status).toBe(201);
    expect([200, 409]).toContain(patch.status);
    const [transaction] = await sql.unsafe("SELECT conversion_factor_snapshot,quantity_base FROM stock_transactions WHERE transaction_id=$1", [uuid('70')]);
    const [unit] = await sql.unsafe('SELECT conversion_factor FROM product_units WHERE product_unit_id=3');
    expect(String(transaction.quantity_base)).toBe(String(transaction.conversion_factor_snapshot));
    if (patch.status === 200) expect(transaction.conversion_factor_snapshot).toBe(unit.conversion_factor);
  });

  it('serializes deactivation and stock so an inactive product never receives a new transaction', async () => {
    const [movement, deactivate] = await Promise.all([
      post({ ...basePayload, transaction_id: uuid('80'), scan_code: 'LOCK-BOX' }),
      patchProduct('PLOCK', { is_active: false }),
    ]);
    const statuses = [movement.status, deactivate.status].sort((left, right) => left - right);
    expect(statuses[1]).toBe(409);
    expect([200, 201]).toContain(statuses[0]);
    const [product] = await sql.unsafe("SELECT is_active FROM products WHERE product_id='PLOCK'");
    const [count] = await sql.unsafe("SELECT count(*) count FROM stock_transactions WHERE product_id='PLOCK'");
    if (product.is_active) expect(String(count.count)).toBe('1');
    else expect(String(count.count)).toBe('0');
  });

  it('keeps old conversion snapshots immutable when the current unit changes later', async () => {
    const id = uuid('90');
    await post({ ...basePayload, transaction_id: id }).expect(201);
    await sql.unsafe('ALTER TABLE product_units DISABLE TRIGGER ALL');
    await sql.unsafe('UPDATE product_units SET conversion_factor=30 WHERE product_unit_id=2');
    await sql.unsafe('ALTER TABLE product_units ENABLE TRIGGER ALL');
    const [transaction] = await sql.unsafe('SELECT conversion_factor_snapshot,quantity_base FROM stock_transactions WHERE transaction_id=$1', [id]);
    expect(transaction.conversion_factor_snapshot).toBe(24);
    expect(String(transaction.quantity_base)).toBe('24');
  });

  it('enforces the UUID primary key as a final database race guard', async () => {
    const id = uuid('100');
    await post({ ...basePayload, transaction_id: id }).expect(201);
    await expect(sql.unsafe(`INSERT INTO stock_transactions(transaction_id,product_id,product_unit_id,scan_point_id,user_id,movement_type,quantity_packages,conversion_factor_snapshot,inventory_before,inventory_after,scan_code_snapshot)
      VALUES($1,'P1',2,'SCAN-01',1,'IN',1,24,124,148,'BOX-NONNUMERIC')`, [id])).rejects.toMatchObject({ code: '23505' });
    const [count] = await sql.unsafe('SELECT count(*) count FROM stock_transactions WHERE transaction_id=$1', [id]);
    expect(String(count.count)).toBe('1');
  });

  it('recognizes a transaction persisted directly in PostgreSQL without process memory', async () => {
    const id = uuid('110');
    await sql.unsafe(`INSERT INTO stock_transactions(transaction_id,product_id,product_unit_id,scan_point_id,user_id,movement_type,quantity_packages,conversion_factor_snapshot,inventory_before,inventory_after,scan_code_snapshot)
      VALUES($1,'P1',2,'SCAN-01',1,'IN',1,24,100,124,'BOX-NONNUMERIC')`, [id]);
    const replay = await post({ ...basePayload, transaction_id: id }).expect(200);
    expect(replay.body.data).toMatchObject({ transaction_id: id, inventory_before: '100', inventory_after: '124' });
    const [inventory] = await sql.unsafe("SELECT quantity_base FROM inventory WHERE product_id='P1'");
    expect(String(inventory.quantity_base)).toBe('100');
  });

  it('rejects inconsistent negative inventory and invalid factors without partial writes', async () => {
    await sql.unsafe('ALTER TABLE inventory DROP CONSTRAINT inventory_quantity_base_check');
    await sql.unsafe("UPDATE inventory SET quantity_base=-1 WHERE product_id='P1'");
    await post({ ...basePayload, transaction_id: uuid('120') }).expect(409);
    await sql.unsafe("UPDATE inventory SET quantity_base=100 WHERE product_id='P1'");
    await sql.unsafe('ALTER TABLE inventory ADD CONSTRAINT inventory_quantity_base_check CHECK (quantity_base >= 0)');

    await sql.unsafe('ALTER TABLE product_units DROP CONSTRAINT product_units_conversion_factor_check');
    await sql.unsafe('UPDATE product_units SET conversion_factor=0 WHERE product_unit_id=2');
    await post({ ...basePayload, transaction_id: uuid('121') }).expect(409);
    await sql.unsafe('UPDATE product_units SET conversion_factor=24 WHERE product_unit_id=2');
    await sql.unsafe('ALTER TABLE product_units ADD CONSTRAINT product_units_conversion_factor_check CHECK (conversion_factor >= 1)');
    const [count] = await sql.unsafe('SELECT count(*) count FROM stock_transactions');
    expect(String(count.count)).toBe('0');
  });

  it('acquires real row locks in products, inventory, product_units order', async () => {
    const productBlocker = postgres(qaUrl!, { max: 1 });
    const inventoryBlocker = postgres(qaUrl!, { max: 1 });
    const unitBlocker = postgres(qaUrl!, { max: 1 });
    let releaseProduct!: () => void;
    let releaseInventory!: () => void;
    let releaseUnit!: () => void;
    const productRelease = new Promise<void>(resolve => { releaseProduct = resolve; });
    const inventoryRelease = new Promise<void>(resolve => { releaseInventory = resolve; });
    const unitRelease = new Promise<void>(resolve => { releaseUnit = resolve; });
    let productReady!: () => void;
    let inventoryReady!: () => void;
    let unitReady!: () => void;
    const productAcquired = new Promise<void>(resolve => { productReady = resolve; });
    const inventoryAcquired = new Promise<void>(resolve => { inventoryReady = resolve; });
    const unitAcquired = new Promise<void>(resolve => { unitReady = resolve; });
    const holdProduct = productBlocker.begin(async tx => {
      await tx.unsafe("SELECT 1 FROM products WHERE product_id='P1' FOR UPDATE"); productReady(); await productRelease;
    });
    await productAcquired;
    const movement = post({ ...basePayload, transaction_id: uuid('130') }).then(response => response);
    const waitBlocked = async (fragment: string) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await sql.unsafe("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1", [`%${fragment}%`]);
        if (rows.length) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for lock: ${fragment}`);
    };
    await waitBlocked('FROM public.products%FOR UPDATE');
    const holdInventory = inventoryBlocker.begin(async tx => {
      await tx.unsafe("SELECT 1 FROM inventory WHERE product_id='P1' FOR UPDATE"); inventoryReady(); await inventoryRelease;
    });
    await inventoryAcquired;
    releaseProduct(); await holdProduct;
    await waitBlocked('FROM public.inventory%FOR UPDATE');
    const holdUnit = unitBlocker.begin(async tx => {
      await tx.unsafe('SELECT 1 FROM product_units WHERE product_unit_id=2 FOR UPDATE'); unitReady(); await unitRelease;
    });
    await unitAcquired;
    releaseInventory(); await holdInventory;
    await waitBlocked('FROM public.product_units%FOR UPDATE');
    releaseUnit(); await holdUnit;
    expect((await movement).status).toBe(201);
    await Promise.all([productBlocker.end(), inventoryBlocker.end(), unitBlocker.end()]);
  }, 15000);
});
