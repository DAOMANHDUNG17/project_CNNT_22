import {describe,expect,it} from 'vitest';
import {mockApi} from '../../src/lib/mock-api';

describe('development Mock Mode',()=>{
 it('supports authentication and structured sample data',async()=>{const login=await mockApi.login('admin','demo');expect(login.data.role).toBe('ADMIN');expect((await mockApi.listProducts()).data.length).toBeGreaterThan(0);expect((await mockApi.summary()).data.transactions.total).toMatch(/^\d+$/u);});
 it('preserves the API abstraction for mutations',async()=>{const id='UNIT-MOCK';await mockApi.createProduct({product_id:id,product_name:'Unit mock',base_unit:'cái'});expect((await mockApi.getProduct(id)).data.product_name).toBe('Unit mock');await mockApi.setProductStatus(id,false);expect((await mockApi.getProduct(id)).data.is_active).toBe(false);});
});
