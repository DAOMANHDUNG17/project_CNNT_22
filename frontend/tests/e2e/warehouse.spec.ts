import {test,expect} from '@playwright/test';

async function login(page:import('@playwright/test').Page){await page.goto('/login');await page.getByLabel('Tên đăng nhập',{exact:true}).fill('admin');await page.getByLabel('Mật khẩu',{exact:true}).fill('demo');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await expect(page.getByRole('heading',{name:/Chào /})).toBeVisible();}

test('all application routes work in Mock Mode without backend',async({page})=>{
 await login(page);
 const routes:[string,RegExp|string][]=[
  ['/',/Chào /],['/products','Sản phẩm'],['/inventory','Tồn kho'],['/transactions','Giao dịch'],
  ['/scan-points','Điểm quét'],['/stock-movement','Nhập / Xuất kho'],['/users','Người dùng']
 ];
 for(const[path,title]of routes){await page.goto(path);await expect(page.getByRole('heading',{name:title})).toBeVisible();await expect(page.locator('.ant-result-error')).toHaveCount(0);}
});

test('mock data and mutations are available',async({page})=>{
 await login(page);await page.goto('/products');
 await expect(page.getByRole('row').filter({hasText:'BUT-BI-01'})).toBeVisible();
 await page.getByRole('button',{name:'Thêm sản phẩm',exact:true}).click();const dialog=page.getByRole('dialog');
 await dialog.getByLabel('Mã sản phẩm',{exact:true}).fill('MOCK-01');await dialog.getByLabel('Tên sản phẩm',{exact:true}).fill('Sản phẩm mock');await dialog.getByLabel('Đơn vị cơ sở',{exact:true}).fill('cái');await dialog.getByRole('button',{name:'Lưu sản phẩm',exact:true}).click();
 await page.getByRole('textbox',{name:'Tìm sản phẩm'}).fill('MOCK-01');await expect(page.getByRole('row').filter({hasText:'MOCK-01'})).toBeVisible();
});
