import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { JwtVerifierService } from '../src/auth/jwt-verifier.service';

const qaUrl = process.env.QA_HISTORY_DATABASE_URL;
const describePostgres = qaUrl ? describe : describe.skip;
const id = (last: number) => `20000000-0000-4000-8000-${String(last).padStart(12, '0')}`;

describePostgres('GET transactions with isolated PostgreSQL', () => {
  let app: INestApplication<App>;
  let sql: ReturnType<typeof postgres>;
  let baseline: string;
  beforeAll(async () => {
    const parsed = new URL(qaUrl!);
    if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' || parsed.pathname !== '/qa_history') throw new Error('Isolated qa_history database required');
    sql = postgres(qaUrl!, { onnotice: () => undefined });
    await sql.unsafe(`
      DROP TABLE IF EXISTS stock_transactions,inventory,product_units,scan_points,users,products;
      CREATE TABLE products(product_id varchar(20) PRIMARY KEY, product_name varchar(150), is_active boolean);
      CREATE TABLE product_units(product_unit_id bigint PRIMARY KEY, product_id varchar(20), unit_name varchar(30), conversion_factor integer, scan_code varchar(80));
      CREATE TABLE scan_points(scan_point_id varchar(20) PRIMARY KEY, point_name varchar(100), is_active boolean);
      CREATE TABLE users(user_id bigint PRIMARY KEY,auth_user_id uuid,username varchar(50),display_name varchar(120),role varchar(20),is_active boolean);
      CREATE TABLE inventory(product_id varchar(20) PRIMARY KEY,quantity_base bigint);
      CREATE TABLE stock_transactions(transaction_id uuid PRIMARY KEY,product_id varchar(20),product_unit_id bigint,
        scan_point_id varchar(20),user_id bigint,movement_type varchar(3),quantity_packages integer,
        conversion_factor_snapshot integer,quantity_base bigint GENERATED ALWAYS AS (quantity_packages::bigint * conversion_factor_snapshot::bigint) STORED,
        inventory_before bigint,inventory_after bigint,scan_code_snapshot varchar(80),created_at timestamptz);
      INSERT INTO users VALUES(9007199254740994,'00000000-0000-4000-8000-000000000001','qa','QA Operator','ADMIN',true);
      INSERT INTO products VALUES('P1','Renamed Product',false),('P2','Other Product',true);
      INSERT INTO product_units VALUES(9007199254740993,'P1','Renamed Box',999,'CURRENT-CODE'),(2,'P2','piece',1,'OTHER');
      INSERT INTO scan_points VALUES('S1','Inactive gate',false),('S2','Gate 2',true);
      INSERT INTO inventory VALUES('P1',9007199254741999),('P2',10);
      INSERT INTO stock_transactions(transaction_id,product_id,product_unit_id,scan_point_id,user_id,movement_type,quantity_packages,conversion_factor_snapshot,inventory_before,inventory_after,scan_code_snapshot,created_at) VALUES
        ('${id(1)}','P1',9007199254740993,'S1',9007199254740994,'IN',1,24,9007199254740993,9007199254741017,'OLD-CODE','2026-11-10T00:00:00Z'),
        ('${id(2)}','P1',9007199254740993,'S1',9007199254740994,'OUT',1,24,9007199254741017,9007199254740993,'OLD-CODE','2026-11-10T00:00:00Z'),
        ('${id(3)}','P2',2,'S2',9007199254740994,'IN',1,1,9,10,'OTHER','2026-11-11T00:00:00Z');
    `);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService).useValue({ query: (text: string, params: (string | number)[] = []) => sql.unsafe(text, params) })
      .overrideProvider(JwtVerifierService).useValue({ verify: async () => '00000000-0000-4000-8000-000000000001' }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    baseline = await state();
  });
  afterAll(async () => { await app?.close(); await sql?.end(); });
  const get = (suffix = '') => request(app.getHttpServer()).get(`/api/transactions${suffix}`).set('Authorization', 'Bearer fixture-token');
  async function state() {
    const rows = await sql.unsafe('SELECT (SELECT json_agg(i ORDER BY product_id) FROM inventory i) inventory,(SELECT json_agg(t ORDER BY transaction_id) FROM stock_transactions t) history');
    return JSON.stringify(rows[0]);
  }

  it('returns default pagination and deterministic newest-first order including tied timestamps', async () => {
    const response = await get().expect(200);
    expect(response.body.data.map((row: {transaction_id: string}) => row.transaction_id)).toEqual([id(3), id(2), id(1)]);
    expect(response.body).toMatchObject({ count: 3, pagination: { page: 1, limit: 20, total: 3, totalPages: 1 } });
  });
  it('paginates in SQL and retains the total beyond the last page', async () => {
    const second = await get('?page=2&limit=1').expect(200);
    expect(second.body.data[0].transaction_id).toBe(id(2));
    expect(second.body.pagination).toEqual({ page: 2, limit: 1, total: 3, totalPages: 3 });
    const empty = await get('?page=5&limit=1').expect(200);
    expect(empty.body.data).toEqual([]); expect(empty.body.count).toBe(3);
  });
  it('finds exact UUID and returns 200 empty for an unknown valid UUID', async () => {
    const found = await get(`?transactionId=${id(1)}`).expect(200);
    expect(found.body.count).toBe(1); expect(found.body.data[0].transaction_id).toBe(id(1));
    const missing = await get(`?transactionId=${id(99)}`).expect(200);
    expect(missing.body.data).toEqual([]); expect(missing.body.pagination.total).toBe(0);
  });
  it('includes inactive products and points when filtering history', async () => {
    const response = await get('?productId=P1&scanPointId=S1').expect(200);
    expect(response.body.count).toBe(2);
    expect(response.body.data.every((row: {product_id:string;scan_point_id:string}) => row.product_id === 'P1' && row.scan_point_id === 'S1')).toBe(true);
  });
  it('filters IN and OUT without inventing rows', async () => {
    const incoming = await get('?movementType=IN').expect(200); expect(incoming.body.count).toBe(2);
    const outgoing = await get('?movementType=OUT').expect(200); expect(outgoing.body.data.map((row:{transaction_id:string}) => row.transaction_id)).toEqual([id(2)]);
    const none = await get('?productId=P2&movementType=OUT').expect(200); expect(none.body.data).toEqual([]);
  });
  it('applies inclusive from, exclusive to, timezones and combined filters', async () => {
    const response = await get('?productId=P1&movementType=IN&scanPointId=S1&from=2026-11-10T07:00:00%2B07:00&to=2026-11-11T00:00:00Z').expect(200);
    expect(response.body.data.map((row:{transaction_id:string}) => row.transaction_id)).toEqual([id(1)]);
    const boundary = await get('?to=2026-11-11T00:00:00Z').expect(200); expect(boundary.body.count).toBe(2);
  });
  it('returns stored snapshots and exact BIGINT strings despite current names/factor/code', async () => {
    const response = await get(`?transactionId=${id(1)}`).expect(200);
    expect(response.body.data[0]).toMatchObject({ product_name: 'Renamed Product', unit_name: 'Renamed Box',
      conversion_factor_snapshot: 24, scan_code_snapshot: 'OLD-CODE', quantity_base: '24',
      product_unit_id: '9007199254740993', user_id: '9007199254740994',
      inventory_before: '9007199254740993', inventory_after: '9007199254741017', display_name: 'QA Operator' });
    expect(response.body.data[0]).not.toHaveProperty('auth_user_id');
  });
  it('preserves orphaned history with explicit null descriptions instead of dropping rows', async () => {
    await sql.unsafe("DELETE FROM products WHERE product_id='P2'");
    const response = await get(`?transactionId=${id(3)}`).expect(200);
    expect(response.body.count).toBe(1); expect(response.body.data[0].product_name).toBeNull();
    await sql.unsafe("INSERT INTO products VALUES('P2','Other Product',true)");
  });
  it('performs no writes to inventory or historical rows across all history reads', async () => {
    expect(await state()).toBe(baseline);
  });
});
