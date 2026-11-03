import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { startSecureServer } from './support/secure.js';

test('real PostgreSQL/Redis admin dashboard CRUD, historical stock and concurrency', async t => {
  const c = await startSecureServer(t);
  const admin = await c.login();
  const suffix = randomBytes(5).toString('hex');
  const productId = `D${suffix}`, pointId = `G${suffix}`;
  const write = (path, body, method='POST', user=admin) => c.request(path,{method,body,cookie:user.cookie,csrf:user.csrf});
  const get = (path,user=admin) => c.request(path,{cookie:user.cookie});
  let item, box, tx, newUser, password = randomBytes(24).toString('base64url');
  await t.test('product, units, scan points create and PATCH; initial inventory is zero', async () => {
    const product=await write('/products',{product_id:productId,product_name:'Integration product',base_unit:'piece'});
    assert.equal(product.status,201);
    assert.equal((await get(`/inventory/${productId}`)).body.data.quantity_base,'0');
    assert.equal((await write(`/products/${productId}`,{product_name:'Updated product'},'PATCH')).status,200);
    item=(await write(`/products/${productId}/units`,{unit_name:'item',conversion_factor:1,scan_code:`${productId}_I`,is_base_unit:true}));
    assert.equal(item.status,201);item=item.body.data;
    box=await write(`/products/${productId}/units`,{unit_name:'box',conversion_factor:10,scan_code:`${productId}_B`});
    assert.equal(box.status,201);box=box.body.data;
    assert.equal((await write(`/product-units/${item.product_unit_id}`,{unit_name:'single'},'PATCH')).status,200);
    assert.equal((await write(`/product-units/${box.product_unit_id}`,{conversion_factor:20},'PATCH')).status,409);
    assert.equal((await write(`/product-units/${box.product_unit_id}`,{scan_code:'HACK'},'PATCH')).status,400);
    assert.equal((await write(`/products/${productId}`,{base_unit:'kg'},'PATCH')).status,409);
    assert.equal((await write('/scan-points',{scan_point_id:pointId,point_name:'Test gate'})).status,201);
    assert.equal((await write(`/scan-points/${pointId}`,{point_name:'Updated gate'},'PATCH')).status,200);
    assert.equal((await write('/products',{product_id:productId,product_name:'Duplicate',base_unit:'piece'})).status,409);
  });
  await t.test('all existing reads retain envelope with authenticated session; KPI quantities grouped by base unit', async () => {
    for(const path of ['/products','/inventory','/transactions','/scan-points','/users','/inventory/low-stock?threshold=10']){
      const result=await get(path);assert.equal(result.status,200,path);assert.equal(result.body.count,result.body.data.length);
      assert.equal(typeof result.body.pagination.total,'number');
    }
    assert.equal((await get(`/products/${productId}`)).body.data.units.length,2);
    const summary=await get('/dashboard/summary?threshold=10');assert.equal(summary.status,200);
    assert(Array.isArray(summary.body.data.inventory_totals));
    assert(summary.body.data.inventory_totals.some(x=>x.base_unit==='piece'));
    assert(summary.body.data.inventory_totals.some(x=>x.base_unit==='item'));
    for(const p of ['/dashboard/stock-trends','/dashboard/stock-trends?granularity=month','/dashboard/top-products','/dashboard/top-products?sortBy=inQuantity&baseUnit=piece'])assert.equal((await get(p)).status,200,p);
    assert.equal((await get('/dashboard/top-products?sortBy=inQuantity')).status,400);
  });
  await t.test('real Redis sessions enforce every write role and reject actor spoofing',async()=>{
    const staff=await c.login('p3_staff'),keeper=await c.login('p3_keeper'),viewer=await c.login('p3_viewer');
    const payload={transaction_id:randomUUID(),scan_point_id:pointId,scan_code:box.scan_code,movement_type:'IN',quantity_packages:1};
    assert.equal((await write('/transactions',payload,'POST',staff)).status,403);
    assert.equal((await write('/transactions',{...payload,movement_type:'OUT'},'POST',viewer)).status,403);
    assert.equal((await write(`/products/${productId}`,{product_name:'Denied'},'PATCH',keeper)).status,403);
    assert.equal((await get('/users',staff)).status,403);
    assert.equal((await write('/transactions',{...payload,user_id:'1',role:'ADMIN'})).status,400);
    assert.equal((await c.request('/transactions',{method:'POST',body:payload,cookie:admin.cookie})).status,403);
    const created=await write('/transactions',{...payload,transaction_id:randomUUID(),quantity_packages:10},'POST',keeper);
    assert.equal(created.status,201);assert.equal(created.body.data.quantity_base,'100');
    const out=await write('/transactions',{...payload,transaction_id:randomUUID(),scan_code:item.scan_code,movement_type:'OUT',quantity_packages:25},'POST',staff);
    assert.equal(out.status,201);assert.equal(out.body.data.inventory_after,'75');tx=out.body.data;
    const actor=(await c.admin.query('SELECT user_id FROM public.stock_transactions WHERE transaction_id=$1',[tx.transaction_id])).rows[0].user_id;
    assert.equal(actor,staff.user.user_id);
    const detail=await get(`/transactions/${tx.transaction_id}`);assert.equal(detail.status,200);
    assert.equal(detail.body.data.conversion_factor_snapshot,1);assert.equal(detail.body.data.quantity_base,'25');
    assert.equal(Object.hasOwn(detail.body.data,'user_id'),false);
  });
  await t.test('duplicate UUID concurrent requests apply once; replay returns historical inventory',async()=>{
    const p={transaction_id:randomUUID(),scan_point_id:pointId,scan_code:item.scan_code,movement_type:'IN',quantity_packages:10};
    const results=await Promise.all([write('/transactions',p),write('/transactions',p)]);
    assert.deepEqual(results.map(x=>x.status).sort(),[200,201]);
    const snapshot=results[0].body.data.inventory_after;
    assert.equal((await c.admin.query('SELECT count(*)::text AS n FROM public.stock_transactions WHERE transaction_id=$1',[p.transaction_id])).rows[0].n,'1');
    assert.equal((await write('/transactions',{...p,quantity_packages:11})).status,409);
    assert.equal((await write('/transactions',{...p,transaction_id:randomUUID(),quantity_packages:1})).status,201);
    const replay=await write('/transactions',p);assert.equal(replay.status,200);assert.equal(replay.body.data.inventory_after,snapshot);
    assert.equal((await write(`/products/${productId}/status`,{is_active:false},'PATCH')).status,200);
    assert.equal((await write('/transactions',p)).status,200);
    assert.equal((await write('/transactions',{...p,transaction_id:randomUUID()})).status,422);
    assert.equal((await write(`/products/${productId}/status`,{is_active:true},'PATCH')).status,200);
  });
  await t.test('two independent PostgreSQL connections serialize stock and rollback overselling',async()=>{
    const id=`C${suffix}`;
    assert.equal((await write('/products',{product_id:id,product_name:'Concurrent stock',base_unit:'item'})).status,201);
    assert.equal((await write(`/products/${id}/units`,{unit_name:'item',conversion_factor:1,scan_code:`${id}_I`,is_base_unit:true})).status,201);
    assert.equal((await write('/transactions',{transaction_id:randomUUID(),scan_point_id:pointId,scan_code:`${id}_I`,movement_type:'IN',quantity_packages:100})).status,201);
    const a=await c.writer.connect(),b=await c.writer.connect();
    try{
      const pids=await Promise.all([a,b].map(async client=>(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
      assert.notEqual(pids[0],pids[1]);
      await Promise.all([a,b].map(client=>client.query('BEGIN ISOLATION LEVEL READ COMMITTED')));
      const invoke=async(client,point)=>{try{const r=(await client.query('SELECT * FROM public.record_stock_movement($1,$2,$3,$4,$5,$6)',[randomUUID(),admin.user.user_id,point,`${id}_I`,'OUT',80])).rows[0];await client.query('COMMIT');return r.result_status;}catch(e){await client.query('ROLLBACK');return e.code;}};
      const outcomes=await Promise.all([invoke(a,'P3_GATE_A'),invoke(b,'P3_GATE_B')]);
      assert.deepEqual(outcomes.sort(),['CREATED','PZ010']);
      assert.equal((await get(`/inventory/${id}`)).body.data.quantity_base,'20');
      assert.equal((await c.admin.query('SELECT count(*)::text AS n FROM public.stock_transactions WHERE product_id=$1',[id])).rows[0].n,'2');
    }finally{a.release();b.release();}
  });
  await t.test('same UUID at distinct scan points conflicts and never applies two stock deltas',async()=>{
    const payload={transaction_id:randomUUID(),scan_point_id:'P3_GATE_A',scan_code:item.scan_code,movement_type:'IN',quantity_packages:1};
    const before=BigInt((await get(`/inventory/${productId}`)).body.data.quantity_base);
    const results=await Promise.all([write('/transactions',payload),write('/transactions',{...payload,scan_point_id:'P3_GATE_B'})]);
    assert.deepEqual(results.map(x=>x.status).sort(),[201,409]);
    assert.equal(BigInt((await get(`/inventory/${productId}`)).body.data.quantity_base),before+1n);
  });
  await t.test('user CRUD, hash projection, role/status and reset invalidate existing sessions',async()=>{
    const username=`u${suffix}`;
    let r=await write('/users',{username,display_name:'Test employee',role:'STAFF',password});assert.equal(r.status,201);
    newUser=r.body.data;assert.equal(Object.hasOwn(newUser,'password_hash'),false);
    let employee=await c.login(username,password);
    assert.equal((await write(`/users/${newUser.user_id}`,{display_name:'Updated employee'},'PATCH')).status,200);
    assert.equal((await write(`/users/${newUser.user_id}`,{role:'VIEWER'},'PATCH')).status,200);
    assert.equal((await c.request('/auth/me',{cookie:employee.cookie})).status,401);
    employee=await c.login(username,password);
    assert.equal((await write(`/users/${newUser.user_id}/status`,{is_active:false},'PATCH')).status,200);
    assert.equal((await c.request('/auth/me',{cookie:employee.cookie})).status,401);
    assert.equal((await write(`/users/${newUser.user_id}/status`,{is_active:true},'PATCH')).status,200);
    employee=await c.login(username,password);
    const replacement=randomBytes(24).toString('base64url');
    assert.equal((await write(`/users/${newUser.user_id}/reset-password`,{password:replacement})).status,200);
    assert.equal((await c.request('/auth/me',{cookie:employee.cookie})).status,401);
    assert.equal((await c.request('/auth/login',{method:'POST',body:{username,password}})).status,401);
    assert.equal((await c.login(username,replacement)).user.user_id,newUser.user_id);
    assert.equal((await write(`/scan-points/${pointId}`,{is_active:false},'PATCH')).status,200);
  });
  await t.test('malformed JSON and API filters fail safely',async()=>{
    const malformed=await fetch(c.base+'/products',{method:'POST',headers:{Origin:'http://127.0.0.1:5173',Cookie:admin.cookie,'Content-Type':'application/json','X-CSRF-Token':admin.csrf},body:'{'});
    assert.equal(malformed.status,400);
    for(const path of ['/products?q=%27%20OR%201%3D1--','/inventory/low-stock?threshold=0','/users?role=STAFF&isActive=true'])assert.equal((await get(path)).status,200);
    assert.equal((await get('/inventory/low-stock?threshold=-1')).status,400);
    assert.equal((await get('/transactions/00000000-0000-4000-8000-000000000000')).status,404);
  });
});
