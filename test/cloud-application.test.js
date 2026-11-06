import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { createCloudApplication } from '../src/cloud/application.js';

test('Cloud app verifies JWT before existing RBAC and blocks legacy password writes at HTTP boundary', async t => {
  const { privateKey, publicKey }=await generateKeyPair('ES256');
  const issuer='https://abcdefghijklmnopqrst.supabase.co/auth/v1';
  const token=await new SignJWT({session_id:'22222222-2222-4222-8222-222222222222',role:'authenticated',user_metadata:{role:'ADMIN'}})
    .setProtectedHeader({alg:'ES256'}).setIssuer(issuer).setAudience('authenticated')
    .setSubject('11111111-1111-4111-8111-111111111111').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  let role='VIEWER', reads=0;
  const writer={async query(sql) {
    if(sql.includes('rate_cloud_request')) return {rows:[{allowed:true,retry_after:0}]};
    if(sql.includes('resolve_cloud_principal')) return {rows:[{user_id:'9007199254740993',username:'synthetic',display_name:'Synthetic',role,is_active:true,auth_version:'0'}]};
    throw new Error('A blocked request reached business SQL');
  }};
  const app=createCloudApplication({ config:{auth:{issuer,audience:'authenticated',algorithm:'ES256',verification:'jwks'},
    allowedOrigins:['http://127.0.0.1:5173'],rateKey:'synthetic-key-'.repeat(4)},reader:{query:async()=>{reads++;return {rows:[]};}},writer,keyResolver:publicKey,logger:{error(){}} });
  const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const request=(path,body)=>fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,Origin:'http://127.0.0.1:5173','Content-Type':'application/json'},body:JSON.stringify(body),
  });
  const product={product_id:'TEST',product_name:'Test',base_unit:'piece'};
  for(const value of ['VIEWER','STAFF','KEEPER']) {role=value;assert.equal((await request('/products',product)).status,403);}
  const movement={transaction_id:'33333333-3333-4333-8333-333333333333',scan_code:'test',scan_point_id:'test',movement_type:'IN',quantity_packages:1};
  for(const value of ['VIEWER','STAFF']) {role=value;assert.equal((await request('/transactions',movement)).status,403);}
  role='ADMIN';
  for(const [path,body] of [['/users',{username:'new',display_name:'New',role:'VIEWER',password:'synthetic-password'}],['/users/1/reset-password',{password:'synthetic-password'}]]) {
    const response=await request(path,body);assert.equal(response.status,503);assert.equal((await response.json()).error.code,'CLOUD_ACCOUNT_OPERATION_BLOCKED');
  }
  assert.equal(reads,0);
});
