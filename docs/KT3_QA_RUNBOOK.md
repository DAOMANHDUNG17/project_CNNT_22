# KT3 — phân quyền VIEWER và khôi phục bản sao QA

## Trạng thái kiểm toán ngày 18/11/2026

- Backend dùng `AuthGuard` kiểm JWT Supabase và đọc lại `public.users` cho mỗi request; tài khoản không tồn tại, bị khóa hoặc sai vai trò nhận 403. `RolesGuard` đối chiếu `@Roles` ở route/class trước khi gọi service.
- VIEWER được GET: `/api/auth/me`, `/api/dashboard`, `/api/products`, `/api/product-units`, `/api/inventory`, `/api/transactions`, `/api/scan-points`, `/api/scan-points/my`. Điểm quét “my” của VIEWER dự kiến là danh sách rỗng. GET `/api/auth/admin-check`, `/api/users`, `/api/users/:id/scan-points` phải nhận 403.
- VIEWER phải nhận 403: `POST /api/products`, `PATCH /api/products/:id`, `POST /api/product-units`, `PATCH /api/product-units/:id`, `POST /api/stock-movements` với cả IN/OUT, `POST /api/users`, `PATCH /api/users/:id`, `PUT /api/users/:id/scan-points`. Source không khai báo route DELETE; 404 không chứng minh phân quyền.
- Giao diện cho VIEWER xem `/`, `/products`, `/inventory`, `/transactions`. `/stock-movement`, `/scan-points`, `/users` hiển thị 403 khi truy cập URL trực tiếp và không xuất hiện trong menu. Trang sản phẩm không có nút thêm/sửa sản phẩm và đơn vị mã quét.
- Supabase hiện dùng PostgreSQL 17.11. Windows có `pg_dump`, `pg_restore`, `psql` 17.11 ở `C:\Program Files\PostgreSQL\17\bin`; dịch vụ PostgreSQL local đang chạy, nhưng chưa có database QA được xác nhận. Tài khoản VIEWER hiện có: `TranNam` / `tranhainam@gmail.com`, active và liên kết `auth.users`. Mật khẩu không có trong source và không được ghi vào tài liệu. Đây là tài khoản ở project hiện tại, chưa phải tài khoản QA độc lập.
- Đã kiểm tra dump `public` từ nguồn bằng `pg_dump` luồng không lưu file: exit code 0. Kết nối hiện tại có quyền SELECT trên bảy bảng nghiệp vụ và `auth.users`; chưa xác minh quyền tạo project QA hoặc khả năng dùng tính năng clone của gói Supabase.
- Kiểm tra catalog hiện tại: RLS bật trên cả bảy bảng nghiệp vụ, không có policy `public` cho `anon`/`authenticated`. Sáu bảng không cấp DML cho hai role này. `user_scan_point_access` có GRANT DML nhưng RLS hiện chặn do không có policy; nên cần kiểm tra lại nếu sau này thêm policy. Không có hàm `SECURITY DEFINER` trong schema `public`.

## Điều kiện trước khi thử request ghi

Chỉ gửi các request POST/PATCH/PUT bên dưới sau khi có **project Supabase QA riêng hoặc database QA độc lập** và xác minh backend localhost dùng đúng QA. Cần đối chiếu project ref của `backend` `DATABASE_URL` và `SUPABASE_URL`, cùng `frontend` `VITE_SUPABASE_URL`/publishable key đều là QA. Khởi động lại hai tiến trình sau khi đổi cấu hình. Không chụp file `.env`, URL kết nối, header Authorization, token hoặc mật khẩu. Nếu localhost còn nối Production, chỉ thực hiện GET và xem UI.

Tài khoản dùng cho bước QA: VIEWER được clone sang QA (nếu dùng Restore to a new project) và mật khẩu do người quản trị cung cấp qua kênh riêng; hoặc VIEWER mới tạo riêng trong QA. Sau đăng nhập, GET `/api/auth/me` phải có `role: "VIEWER"`, `is_active: true`. Không dùng tài khoản ADMIN để chứng minh 403.

## Kịch bản A — localhost với VIEWER

1. Trên QA, chạy [kt3-readonly-checks.sql](kt3-readonly-checks.sql) và lưu kết quả **trước** request. Dùng cùng múi giờ phiên SQL khi so sánh hash; nên dùng UTC. Không có người khác ghi vào QA trong khoảng đo.
2. Đăng nhập `http://127.0.0.1:5173/login`. Chụp menu tài khoản có vai trò Người xem. Xem `/`, `/products` (mở một sản phẩm và đơn vị mã quét), `/inventory`, `/transactions`. Chụp màn hình sản phẩm không có nút thêm/sửa.
3. Truy cập trực tiếp `/stock-movement`, `/scan-points`, `/users`: mỗi trang phải là 403. Chụp một hoặc ba ảnh có URL và thông báo. Kiểm tra menu không có ba mục này.
4. Trong DevTools Console của **trang frontend QA** sau đăng nhập, nhập hàm dưới đây. Hàm đọc phiên hiện tại tại trình duyệt, gửi tới backend localhost và chỉ in method/path/status. Không in token hoặc body response. Trong tab Network, chỉ chụp status và URL, ẩn Request Headers.

```js
async function kt3(method, path, body) {
  const key = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
  if (!key) throw new Error('Chưa có phiên Supabase QA');
  const token = JSON.parse(localStorage.getItem(key)).access_token;
  const response = await fetch(`http://127.0.0.1:3000/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  console.table([{ method, path, status: response.status }]);
}
```

5. Xác nhận GET trả 200: `kt3('GET','/auth/me')`, `kt3('GET','/products')`, `kt3('GET','/product-units')`, `kt3('GET','/inventory')`, `kt3('GET','/transactions')`, `kt3('GET','/dashboard')`. GET `/scan-points` và `/scan-points/my` cũng được phép dù trang quản trị điểm quét bị hạn chế. `kt3('GET','/users')` và `kt3('GET','/auth/admin-check')` phải là 403.
6. Chỉ trên QA, gửi request ghi hợp lệ về cấu trúc. Thay `QA_PRODUCT_ID`, `QA_UNIT_ID`, `QA_SCAN_CODE`, `QA_SCAN_POINT` bằng giá trị **đang có trong QA** ở bước 1; dùng `QA-KT3-NEW` cho mã sản phẩm chưa có. Mỗi request dưới đây phải là 403. Không chạy nếu backend chưa được xác minh nối QA:

```js
await kt3('POST', '/products', { product_id: 'QA-KT3-NEW', product_name: 'KT3 QA', base_unit: 'cai' });
await kt3('PATCH', '/products/QA_PRODUCT_ID', { product_name: 'KT3 blocked' });
await kt3('POST', '/product-units', { product_id: 'QA_PRODUCT_ID', unit_name: 'hop-kt3', conversion_factor: 2, scan_code: 'QA-KT3-NEW', is_base_unit: false });
await kt3('PATCH', '/product-units/QA_UNIT_ID', { scan_code: 'QA-KT3-EDIT' });
await kt3('POST', '/stock-movements', { transaction_id: crypto.randomUUID(), scan_code: 'QA_SCAN_CODE', scan_point_id: 'QA_SCAN_POINT', movement_type: 'IN', quantity_packages: 1 });
await kt3('POST', '/stock-movements', { transaction_id: crypto.randomUUID(), scan_code: 'QA_SCAN_CODE', scan_point_id: 'QA_SCAN_POINT', movement_type: 'OUT', quantity_packages: 1 });
await kt3('PUT', '/users/1/scan-points', { scan_point_ids: [] });
```

`POST /users` và `PATCH /users/:id` cũng được test tự động trong `backend/test/kt3-viewer.e2e-spec.ts`; có thể thử thủ công trên QA nếu cần ảnh. Không dùng mật khẩu thật trong request tạo user: guard phải trả 403 trước khi dịch vụ tạo tài khoản chạy.

7. Chạy lại cùng SQL trên QA. So sánh `row_count`, `row_digest`, chi tiết sản phẩm, tồn và lịch sử trước/sau. Chụp hai kết quả đặt cạnh nhau. Mọi khác biệt phải điều tra trước khi kết luận; test giả lập 403 không thay thế bằng chứng PostgreSQL thật.

## Kịch bản B — backup/restore độc lập

**Đường ít phức tạp nhất nếu gói Supabase hỗ trợ:** trong Dashboard nguồn, vào `Database > Backups > Restore to a New Project`, chọn mốc backup và đặt project QA mới. Kiểm tra tên/project ref QA khác nguồn trước khi xác nhận. Đây là bản sao database độc lập, có cả dữ liệu Auth và khóa gốc mã hóa; cần cấu hình lại Auth/API keys và các thiết lập ứng dụng cho QA. Tính năng này yêu cầu gói trả phí và physical backups; chưa xác minh project hiện tại đủ điều kiện hoặc chi phí. Không chọn lệnh restore **trên project nguồn**. Theo [tài liệu Supabase](https://supabase.com/docs/guides/platform/clone-project), Storage objects, Edge Functions và một số cài đặt không đi theo bản sao.

Trước restore, lưu kết quả SQL chỉ đọc từ nguồn **gần mốc backup nhất có thể**; sau restore chạy cùng file trên QA. Nếu nguồn tiếp tục có giao dịch sau mốc backup, chênh lệch hiện tại so với QA là dự kiến: đối chiếu theo mốc backup và các bản ghi ổn định. Kiểm tra số bản ghi, các hash, khóa chính/ngoại hợp lệ, orphan bằng 0, và mẫu sản phẩm/tồn/giao dịch. Chụp mốc backup, tên project QA, kết quả restore và SQL sau restore. Chỉ kết luận restore PASS nếu có bản sao thực tế và đối chiếu đạt.

**Backup logic bổ sung:** `pg_dump` 17.11 phù hợp server 17.11. Từ PowerShell, đặt `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGSSLMODE=require` theo màn hình Connect (direct nếu mạng hỗ trợ IPv6, session pooler cổng 5432 nếu cần IPv4); dùng `-W` để nhập password ở prompt, không đặt password/URL trong lệnh hoặc ảnh. Lưu archive ở nơi được bảo vệ ngoài repo:

```powershell
$bin = 'C:\Program Files\PostgreSQL\17\bin'
$archive = 'C:\KT3-QA\public.backup'
& "$bin\pg_dump.exe" -h $env:PGHOST -p $env:PGPORT -U $env:PGUSER -d $env:PGDATABASE -W -n public -Fc --no-owner --no-privileges -f $archive
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
& "$bin\pg_restore.exe" -l $archive | Select-Object -First 20
```

Archive `-n public` chỉ chứa schema/data `public`: **không** chứa Supabase Auth, Storage objects, roles toàn cục hoặc cấu hình project. Trong database thực tế, `public.users.auth_user_id` có FK sang `auth.users`; vì vậy không coi việc restore archive `public` đơn lẻ vào PostgreSQL trống là bản sao hoàn chỉnh. Nếu không dùng được clone, cần thiết kế restore QA local với Auth tối thiểu và kiểm tra FK hoặc dùng quy trình migration chính thức của Supabase sang project QA; chỉ thực hiện khi đã duyệt đích QA. Xem [tài liệu backup](https://supabase.com/docs/guides/platform/backups) và [migration CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Ảnh minh chứng cần nộp

1. VIEWER đăng nhập và vai trò trên menu; bốn trang được xem; trang sản phẩm/đơn vị không có nút sửa/thêm.
2. Ba URL bị giới hạn và thông báo 403; Console hoặc Network cho từng nhóm API ghi có method/path/status 403, không hiển thị headers/token.
3. SQL QA trước và sau các request bị từ chối: số dòng, hash, mẫu sản phẩm/tồn/lịch sử giống nhau.
4. PostgreSQL version, phiên bản ba công cụ, quyền dump hoặc archive hợp lệ; không chụp thông tin kết nối.
5. Dashboard backup với thời điểm, project QA độc lập, tiến trình restore hoàn tất; SQL đối chiếu nguồn/bản sao, constraint và orphan.
