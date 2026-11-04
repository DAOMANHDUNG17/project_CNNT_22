import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import type { MovementRequest } from '../../../docs/api-client';

// No credential in source, browser bundle, trace, screenshot or saved storageState.
const origin='http://127.0.0.1:5173';
const suffix=randomBytes(4).toString('hex');
const productId=`FE${suffix}`, scanCode=`${productId}_I`;
const concurrencyId=`FC${suffix}`, concurrencyCode=`${concurrencyId}_I`;
const uiProductId=`FU${suffix}`;
const secret=(username:string)=>readFileSync(new URL(`../../../infra/phase3/local/${username}-password.txt`,import.meta.url),'utf8');
async function login(page:Page,username='p3_admin',password=secret(username)){
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập',{exact:true}).fill(username);
  await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await expect(page.getByRole('heading',{name:/Chào /})).toBeVisible();
}
async function call(context:BrowserContext,path:string,body?:object,method='POST'){
  const csrf=(await(await context.request.get(`${origin}/api/auth/csrf`)).json() as {data:{csrf_token:string}}).data.csrf_token;
  return context.request.fetch(`${origin}/api${path}`,{method,headers:{Origin:origin,'X-CSRF-Token':csrf},...(body?{data:body}:{})});
}
async function movement(page:Page,station:string,code:string,quantity:number,type:'IN'|'OUT'='IN'){
  await page.goto(`/stock-movement?station=${station}`);
  await expect(page.getByRole('heading',{name:'Ghi nhận chuyển động'})).toBeVisible();
  await expect(page.getByText(`${station} ·`,{exact:false}).first()).toBeVisible();
  if(type==='OUT')await page.getByText('Xuất kho',{exact:true}).first().click();
  await page.getByLabel('Mã quét đơn vị',{exact:true}).fill(code);
  await page.getByRole('spinbutton',{name:'Số lượng gói'}).fill(String(quantity));
}

test.describe.serial('real frontend + isolated backend',()=>{
  test.afterEach(async({page},info)=>{
    if(info.status!==info.expectedStatus&&info.title.startsWith('Products')){
      mkdirSync('artifacts',{recursive:true});
      await page.screenshot({path:'artifacts/product-diagnostic.png'}).catch(()=>{});
      writeFileSync('test-results/product-diagnostic.txt',await page.locator('body').innerText());
      writeFileSync('test-results/product-aria.txt',await page.locator('.ant-modal').filter({hasText:'Thêm đơn vị sản phẩm'}).ariaSnapshot());
    }
  });
  test.beforeAll(async({browser})=>{
    const context=await browser.newContext(),page=await context.newPage();
    await login(page);
    for(const id of ['SCAN01','SCAN02']){
      const existing=await context.request.get(`${origin}/api/scan-points?limit=100`);
      const points=await existing.json() as {data:Array<{scan_point_id:string}>};
      if(!points.data.some(p=>p.scan_point_id===id))expect((await call(context,'/scan-points',{scan_point_id:id,point_name:`Trạm demo ${id}`})).status()).toBe(201);
    }
    for(const[id,code]of[[productId,scanCode],[concurrencyId,concurrencyCode]]){
      expect((await call(context,'/products',{product_id:id,product_name:`Demo frontend ${id}`,base_unit:'cây'})).status()).toBe(201);
      expect((await call(context,`/products/${id}/units`,{unit_name:'cây',conversion_factor:1,scan_code:code,is_base_unit:true})).status()).toBe(201);
    }
    expect((await call(context,'/transactions',{transaction_id:randomUUID(),scan_point_id:'SCAN01',scan_code:concurrencyCode,movement_type:'IN',quantity_packages:100})).status()).toBe(201);
    await context.close();
  });

  test('proxy, login, HttpOnly session restoration and dashboard APIs',async({page,context})=>{
    expect((await context.request.get('/api/health')).status()).toBe(200);
    const successful=new Set<string>();
    page.on('response',response=>{if(response.ok()&&response.url().includes('/api/dashboard/'))successful.add(new URL(response.url()).pathname);});
    await login(page);
    await expect(page.getByRole('heading',{name:'Nhịp hoạt động kho'})).toBeVisible();
    await expect.poll(()=>successful.size).toBe(3);
    const cookie=(await context.cookies()).find(c=>c.name==='warehouse_session');
    expect(cookie?.httpOnly).toBe(true);expect(cookie?.sameSite).toBe('Lax');
    expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);
    await page.reload();await expect(page.getByRole('heading',{name:/Chào /})).toBeVisible();
    mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/dashboard-desktop.png',fullPage:true});
    // API-client import is permitted; secret files outside frontend/docs are not.
    expect((await context.request.get('/@fs/D:/Project_CNNT/infra/phase3/local/p3_admin-password.txt')).status()).toBe(403);
  });

  test('Products and Units: create, detail, update, rename, status and server pagination',async({page})=>{
    await login(page);await page.goto('/products');
    await page.getByRole('button',{name:'Thêm sản phẩm',exact:true}).click();
    const modal=page.getByRole('dialog');
    await modal.getByLabel('Mã sản phẩm',{exact:true}).fill(uiProductId);
    await modal.getByLabel('Tên sản phẩm',{exact:true}).fill(`Sổ demo ${suffix}`);
    await modal.getByLabel('Đơn vị cơ sở',{exact:true}).fill('quyển');
    await modal.getByRole('button',{name:'Lưu sản phẩm',exact:true}).click();await expect(modal).not.toBeVisible();
    await page.getByRole('textbox',{name:'Tìm sản phẩm'}).fill(uiProductId);
    const row=page.getByRole('row').filter({hasText:uiProductId});await expect(row).toBeVisible();
    await row.getByRole('button',{name:'Chi tiết',exact:true}).click();
    const drawer=page.getByRole('dialog');await drawer.getByRole('button',{name:'Thêm đơn vị',exact:true}).click();
    const unit=page.getByRole('dialog',{name:'Thêm đơn vị sản phẩm'});
    await unit.getByLabel('Tên đơn vị',{exact:true}).fill('quyển');await unit.getByLabel('Mã quét',{exact:true}).fill(`${uiProductId}_I`);
    await unit.getByRole('button',{name:'Lưu đơn vị',exact:true}).click();await expect(unit).not.toBeVisible();
    await expect(drawer.getByText(`${uiProductId}_I`,{exact:true})).toBeVisible();
    await drawer.getByRole('button',{name:'Đổi tên',exact:true}).click();
    const rename=page.getByRole('dialog',{name:'Đổi tên đơn vị'});await rename.getByLabel('Tên đơn vị',{exact:true}).fill('cuốn');
    await rename.getByRole('button',{name:'Lưu đơn vị',exact:true}).click();await expect(rename).not.toBeVisible();await expect(drawer.getByText('cuốn',{exact:true})).toBeVisible();
    await drawer.getByRole('button',{name:/^(Close|Đóng)$/u}).click();
    await row.getByRole('button',{name:'Sửa',exact:true}).click();
    const edit=page.getByRole('dialog',{name:'Sửa sản phẩm'});await edit.getByLabel('Tên sản phẩm',{exact:true}).fill(`Sổ đã cập nhật ${suffix}`);
    await edit.getByRole('button',{name:'Lưu sản phẩm',exact:true}).click();await expect(edit).not.toBeVisible();
    await row.getByRole('button',{name:'Vô hiệu hóa',exact:true}).click();await page.getByRole('button',{name:'Đồng ý',exact:true}).click();
    await expect(row.getByText('Ngừng hoạt động',{exact:true})).toBeVisible();
    await expect(page.getByText('1 kết quả',{exact:true})).toBeVisible();
  });

  test('Stock Movement: actual IN then OUT, same unit snapshots and history detail',async({page})=>{
    await login(page);await movement(page,'SCAN01',scanCode,20);
    await page.getByRole('button',{name:'Xác nhận nhập kho',exact:true}).click();await expect(page.getByText('Ghi nhận thành công',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Giao dịch mới',exact:true}).click();await page.getByText('Xuất kho',{exact:true}).first().click();
    await page.getByLabel('Mã quét đơn vị',{exact:true}).fill(scanCode);await page.getByRole('spinbutton',{name:'Số lượng gói'}).fill('3');
    await page.getByRole('button',{name:'Xác nhận xuất kho',exact:true}).click();await expect(page.getByText('Ghi nhận thành công',{exact:true})).toBeVisible();
    await page.goto('/transactions');await page.getByRole('textbox',{name:'Lọc mã sản phẩm'}).fill(productId);
    await expect(page.getByRole('row').filter({hasText:productId})).toHaveCount(2);
    await page.getByRole('row').filter({hasText:productId}).first().getByRole('button',{name:'Chi tiết',exact:true}).click();
    await expect(page.getByText('Hệ số tại thời điểm ghi',{exact:true})).toBeVisible();
  });

  test('committed response loss: reload and retry preserves UUID/payload, real DUPLICATE',async({page,context})=>{
    await login(page);await movement(page,'SCAN02',scanCode,5);
    let first:MovementRequest|undefined;
    await page.route('**/api/transactions',async route=>{
      if(route.request().method()!=='POST'){await route.continue();return;}
      first=route.request().postDataJSON() as MovementRequest;
      const response=await route.fetch();expect(response.status()).toBe(201);
      await route.abort('failed');
      await page.unroute('**/api/transactions');
    });
    await page.getByRole('button',{name:'Xác nhận nhập kho',exact:true}).click();
    await expect(page.getByText('Yêu cầu đang chờ xác nhận kết quả',{exact:true})).toBeVisible();
    expect(first?.transaction_id).toMatch(/^[0-9a-f-]{36}$/u);
    page.once('dialog',dialog=>{void dialog.accept();});
    await page.reload();await expect(page.getByText(first!.transaction_id,{exact:true})).toBeVisible();
    const retried=page.waitForRequest(request=>request.url().endsWith('/api/transactions')&&request.method()==='POST');
    await page.getByRole('button',{name:'Kiểm tra / Thử lại cùng yêu cầu',exact:true}).click();
    expect((await retried).postDataJSON()).toEqual(first);
    await expect(page.getByText('DUPLICATE',{exact:true})).toBeVisible();
    const inventory=await(await context.request.get(`/api/inventory/${productId}`)).json() as {data:{quantity_base:string}};
    expect(inventory.data.quantity_base).toBe('22');
    await page.getByRole('button',{name:'Giao dịch mới',exact:true}).click();
  });

  test('Inventory actual detail, low-stock filtering and empty state',async({page})=>{
    await login(page);await page.goto('/inventory?tab=low-stock');
    await page.getByRole('textbox',{name:'Tìm tồn thấp'}).fill(productId);
    await expect(page.getByText('Chưa có dữ liệu phù hợp',{exact:true})).toBeVisible();
    await page.getByRole('spinbutton',{name:'Ngưỡng tồn'}).fill('30');await page.getByRole('spinbutton',{name:'Ngưỡng tồn'}).press('Tab');
    const row=page.getByRole('row').filter({hasText:productId});await expect(row).toBeVisible();
    await expect(row.getByText('22',{exact:true})).toBeVisible();await row.getByRole('button',{name:'Chi tiết tồn',exact:true}).click();
    await expect(page.getByRole('dialog').getByText('22',{exact:true})).toBeVisible();
  });

  test('Scan Points create/update and station-specific URL',async({page})=>{
    await login(page);await page.goto('/scan-points');await page.getByRole('button',{name:'Thêm điểm quét',exact:true}).click();
    const modal=page.getByRole('dialog');const id=`FS${suffix}`;
    await modal.getByLabel('Mã điểm quét',{exact:true}).fill(id);await modal.getByLabel('Tên điểm quét',{exact:true}).fill('Trạm kiểm thử giao diện');
    await modal.getByRole('button',{name:'Lưu điểm quét',exact:true}).click();await expect(modal).not.toBeVisible();
    // Server page size may put the new point on a later page; request page 1 at size 100 via UI selector.
    const size=page.getByRole('combobox',{name:'Page Size'});
    if(await size.count()){await size.click();await page.getByTitle('100 / trang',{exact:true}).click();}
    const row=page.getByRole('row').filter({hasText:id});await expect(row).toBeVisible();
    await row.getByRole('button',{name:'Sửa điểm quét',exact:true}).click();const edit=page.getByRole('dialog');
    await edit.getByLabel('Tên điểm quét',{exact:true}).fill('Trạm đã cập nhật');await edit.getByRole('button',{name:'Lưu điểm quét',exact:true}).click();await expect(edit).not.toBeVisible();
    await row.getByRole('link',{name:'Mở trạm',exact:true}).click();await expect(page).toHaveURL(new RegExp(`station=${id}`));
  });

  test('Users: create/edit role, lock/unlock and reset password through actual API',async({page,browser})=>{
    await login(page);await page.goto('/users');await page.getByRole('button',{name:'Thêm người dùng',exact:true}).click();
    const username=`fe_${suffix}`,initial=randomBytes(24).toString('base64url'),replacement=randomBytes(24).toString('base64url');
    const modal=page.getByRole('dialog');await modal.getByLabel('Tên đăng nhập',{exact:true}).fill(username);await modal.getByLabel('Tên hiển thị',{exact:true}).fill('Nhân viên kiểm thử');
    await modal.getByLabel('Mật khẩu ban đầu',{exact:true}).fill(initial);await modal.getByRole('button',{name:'Lưu người dùng',exact:true}).click();await expect(modal).not.toBeVisible();
    await page.getByRole('textbox',{name:'Tìm người dùng'}).fill(username);const row=page.getByRole('row').filter({hasText:username});await expect(row).toBeVisible();
    await row.getByRole('button',{name:'Sửa người dùng',exact:true}).click();const edit=page.getByRole('dialog');
    await edit.getByLabel('Tên hiển thị',{exact:true}).fill('Nhân viên đã cập nhật');await edit.getByLabel('Vai trò',{exact:true}).click();await page.getByTitle('Người xem',{exact:true}).click();
    await edit.getByRole('button',{name:'Lưu người dùng',exact:true}).click();await expect(edit).not.toBeVisible();await expect(row.getByText('Người xem',{exact:true})).toBeVisible();
    await row.getByRole('button',{name:'Khóa',exact:true}).click();await page.getByRole('button',{name:'Đồng ý',exact:true}).click();await expect(row.getByRole('button',{name:'Mở khóa',exact:true})).toBeVisible();
    await row.getByRole('button',{name:'Mở khóa',exact:true}).click();await page.getByRole('button',{name:'Đồng ý',exact:true}).click();await expect(row.getByRole('button',{name:'Khóa',exact:true})).toBeVisible();
    await row.getByRole('button',{name:'Đặt lại mật khẩu',exact:true}).click();const reset=page.getByRole('dialog');await reset.getByLabel('Mật khẩu mới',{exact:true}).fill(replacement);await reset.getByRole('button',{name:'Xác nhận đặt lại',exact:true}).click();await expect(reset).not.toBeVisible();
    const context=await browser.newContext(),employee=await context.newPage();await login(employee,username,replacement);
    await employee.goto('/users');await expect(employee.getByText('Bạn chưa có quyền truy cập',{exact:true})).toBeVisible();await context.close();
  });

  test('KEEPER, STAFF, VIEWER route guards and backend permissions',async({browser})=>{
    for(const role of ['keeper','staff','viewer']){
      const context=await browser.newContext(),page=await context.newPage();await login(page,`p3_${role}`);
      for(const path of ['/products','/inventory','/transactions','/scan-points']){await page.goto(path);await expect(page.locator('h1')).toBeVisible();}
      await page.goto('/users');await expect(page.getByText('Bạn chưa có quyền truy cập',{exact:true})).toBeVisible();expect((await context.request.get('/api/users')).status()).toBe(403);
      await page.goto('/stock-movement');
      if(role==='viewer')await expect(page.getByText('Bạn chưa có quyền truy cập',{exact:true})).toBeVisible();
      else {await expect(page.getByRole('heading',{name:'Ghi nhận chuyển động'})).toBeVisible();if(role==='staff')await expect(page.getByRole('radio',{name:'Nhập kho'})).toBeDisabled();}
      await context.close();
    }
  });

  test('two separate sessions and stations concurrently OUT cannot oversell',async({browser})=>{
    const a=await browser.newContext(),b=await browser.newContext(),pa=await a.newPage(),pb=await b.newPage();
    await login(pa,'p3_admin');await login(pb,'p3_keeper');
    await movement(pa,'SCAN01',concurrencyCode,80,'OUT');await movement(pb,'SCAN02',concurrencyCode,80,'OUT');
    await Promise.all([pa.getByRole('button',{name:'Xác nhận xuất kho',exact:true}).click(),pb.getByRole('button',{name:'Xác nhận xuất kho',exact:true}).click()]);
    await expect.poll(async()=>{
      const texts=await Promise.all([pa,pb].map(p=>p.locator('body').innerText()));
      return {success:texts.filter(t=>t.includes('Ghi nhận thành công')).length,insufficient:texts.filter(t=>t.includes('Không đủ tồn kho')).length};
    }).toEqual({success:1,insufficient:1});
    const inventory=await(await a.request.get(`/api/inventory/${concurrencyId}`)).json() as {data:{quantity_base:string}};expect(inventory.data.quantity_base).toBe('20');
    await a.close();await b.close();
  });

  test('403/404, mobile layout and logout revoke the browser session',async({page,context})=>{
    await login(page);await page.goto('/403');await expect(page.getByText('Bạn chưa có quyền truy cập',{exact:true})).toBeVisible();
    await page.goto('/unknown-frontend-route');await expect(page.getByText('Không tìm thấy trang',{exact:true})).toBeVisible();
    await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.getByRole('button',{name:'Mở menu',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Mở menu',exact:true}).click();await expect(page.getByRole('dialog',{name:'Điều hướng'})).toBeVisible();await page.getByRole('button',{name:/^(Close|Đóng)$/u}).click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:'artifacts/dashboard-mobile.png',fullPage:true});
    await page.setViewportSize({width:1440,height:1000});await page.locator('.profile-button').click();await page.getByRole('menuitem',{name:'Đăng xuất'}).click();
    await expect(page.getByRole('heading',{name:'Đăng nhập vào kho'})).toBeVisible();expect((await context.request.get('/api/auth/me')).status()).toBe(401);
    await page.screenshot({path:'artifacts/login-desktop.png',fullPage:true});
  });
});
