import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createStockWriteRepository } from '../src/repositories/stock-write.js';
const input=()=>({transaction_id:randomUUID(),scan_point_id:'A',scan_code:'CODE',movement_type:'OUT',quantity_packages:1});
test('stock service retries the whole transaction with same actor and UUID after serialization error',async()=>{
  let attempts=0;const commands=[],payload=input(),seen=[];
  const db={async connect(){const attempt=++attempts;return{async query(sql,values){commands.push(sql);
    if(sql.includes('record_stock_movement')){seen.push(values);if(attempt===1)throw Object.assign(new Error('safe'),{code:'40001'});return{rows:[{result_status:'CREATED',current_inventory:'10'}]};}
    if(sql.includes('FROM "public".stock_transactions'))return{rows:[{transaction_id:payload.transaction_id,inventory_after:'10'}]};
    return{rows:[]};},release(){}};}};
  const result=await createStockWriteRepository(db).record('7',payload);
  assert.equal(result.meta.result_status,'CREATED');assert.equal(attempts,2);assert.deepEqual(seen[0],seen[1]);
  assert.equal(seen[0][1],'7');assert(commands.includes('ROLLBACK'));assert(commands.includes('COMMIT'));
});
test('commit connection loss returns an explicit unknown result without a second mutation',async()=>{
  const payload=input();let calls=0,discarded=false;
  const db={async connect(){return{async query(sql){if(sql.includes('record_stock_movement')){calls++;return{rows:[{result_status:'CREATED'}]};}
    if(sql.includes('FROM "public".stock_transactions'))return{rows:[{transaction_id:payload.transaction_id}]};
    if(sql==='COMMIT')throw Object.assign(new Error('connection lost'),{code:'08006'});return{rows:[]};},release(discard){discarded=discard;}};}};
  await assert.rejects(createStockWriteRepository(db).record('7',payload),e=>e.status===503&&e.code==='TRANSACTION_OUTCOME_UNKNOWN'&&e.transaction_id===payload.transaction_id);
  assert.equal(calls,1);assert.equal(discarded,true);
});
test('insufficient inventory is rolled back and never automatically retried',async()=>{
  let calls=0;const commands=[];
  const db={async connect(){return{async query(sql){commands.push(sql);if(sql.includes('record_stock_movement')){calls++;throw Object.assign(new Error('internal SQL message'),{code:'PZ010'});}return{rows:[]};},release(){}};}};
  await assert.rejects(createStockWriteRepository(db).record('7',input()),e=>e.status===409&&e.code==='INSUFFICIENT_INVENTORY'&&!e.message.includes('SQL'));
  assert.equal(calls,1);assert(commands.includes('ROLLBACK'));assert(!commands.includes('COMMIT'));
});
