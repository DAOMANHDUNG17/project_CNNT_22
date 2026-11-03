# Smart Stationery Warehouse — Backend Read API

Backend giai đoạn 2: Node.js 24+, Express 5, pg, PostgreSQL 17 tại 127.0.0.1:5432, database smart_warehouse, schema public. Tài khoản ứng dụng warehouse_readonly. API đọc dữ liệu thật; không chạy migration, seed, cấp quyền hoặc gọi record_stock_movement().

## 1. Cài đặt và cấu hình

```powershell
Set-Location D:\Project_CNNT
node --version
npm.cmd ci
```

Dùng npm.cmd khi PowerShell chặn npm.ps1, không đổi Execution Policy. Giữ nguyên .env đã có mật khẩu. Trên máy mới, chép .env.example thành .env và tự điền mật khẩu:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=smart_warehouse
PGUSER=warehouse_readonly
PGPASSWORD=
PGSCHEMA=public
PGPOOL_MAX=5
PGCONNECT_TIMEOUT_MS=5000
PGQUERY_TIMEOUT_MS=5000
```

Không để trống PGPASSWORD khi chạy thật; không commit .env. Biến môi trường tiến trình ưu tiên hơn .env. Mật khẩu có #/khoảng trắng cần dấu nháy phù hợp. Backend từ chối PGUSER=postgres. HTTP HOST chỉ nhận 127.0.0.1, ::1, localhost, không bind LAN/0.0.0.0.

Pool tối đa 5 kết nối; timeout kết nối 5 giây, statement timeout 5 giây, client query timeout 6 giây. Mọi kết nối đặt default_transaction_read_only=on; quyền DB là giới hạn chính. pool.query() tự mượn/trả client. Ctrl+C/SIGTERM: ngừng HTTP, đợi request rồi pool.end(); quá 10 giây mới đóng cưỡng bức.

## 2. Cấp SELECT thủ công trong pgAdmin

Role warehouse_readonly đã tồn tại; không tạo lại role, đổi mật khẩu hoặc dùng quản trị viên trong Backend.

| Đối tượng | Quyền ứng dụng |
| --- | --- |
| smart_warehouse | CONNECT, không CREATE |
| public | USAGE, không CREATE |
| products, product_units, inventory, stock_transactions, scan_points | SELECT, không quyền ghi/GRANT OPTION |
| users và các cột users | Không SELECT hoặc quyền ghi |

Khi cần bổ sung bốn quyền đọc giai đoạn 2:

1. Dùng tài khoản quản trị có quyền cấp SELECT trong pgAdmin, chọn **Databases → smart_warehouse → Query Tool**.
2. Mở scripts/grant-phase2-readonly.sql, bỏ vùng chọn và chạy toàn bộ bằng Execute Script/F5, xác nhận COMMIT. Nếu lỗi, chạy ROLLBACK; trong cùng Query Tool.
3. Chạy scripts/verify-phase2-readonly.sql trên cùng DB, dòng cuối phải phase2_permissions=PASS. Xem quyền từng bảng/cột khi FAIL.
4. Chạy npm.cmd run check:phase2 trên Backend để xác minh bằng tài khoản ứng dụng.

Script chỉ GRANT SELECT trên bốn bảng hiện có. Không sửa dữ liệu/schema/account/password/function, cấp quyền users/sequence hoặc ALTER DEFAULT PRIVILEGES. Nếu phát hiện quyền PUBLIC/membership rộng hơn, script báo lỗi thay vì tự REVOKE. Không script GRANT nào được gọi từ npm, API hay test.

create-warehouse-readonly.sql hiện chỉ là truy vấn kiểm tra role do người dùng chỉnh. verify-warehouse-readonly.sql lưu kỳ vọng giai đoạn 1, chỉ products được đọc; dùng verify-phase2-readonly.sql cho giai đoạn 2.

## 3. Kiểm thử và chạy

```powershell
npm.cmd run check:db
npm.cmd run check:phase2
npm.cmd test
npm.cmd run test:integration
```

check:db kiểm tra đăng nhập/read-only/metadata/SELECT products. check:phase2 kiểm tra identity/session, quyền hiệu lực bảng/cột, membership, CREATE và kiểu cột API cần dùng; không SELECT dữ liệu users. Nếu thiếu quyền, test:integration dừng ở preflight với mã lỗi, không cấp quyền/fallback account.

Unit test dùng DB giả lập chỉ để kiểm tra logic/biên, không kết luận kết nối thật. Integration dùng PostgreSQL thật trên HTTP port tạm bind 127.0.0.1, đi qua nhiều trang, đối chiếu bảng gốc và dựng JOIN độc lập bằng JavaScript, kiểm tra tìm kiếm/lọc/400/404. Transaction so với snapshot và số lượng đã lưu. Không INSERT/UPDATE/DELETE kể cả để rollback.

Integration so hash/count dữ liệu **năm bảng được phép đọc**, metadata sáu bảng và hash định nghĩa record_stock_movement() trước/sau; không đọc/hash dữ liệu users. Chạy khi không có hệ thống khác ghi đồng thời để phép đối chiếu ổn định.

Trước khi chạy server, kiểm tra cổng 3000:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue
```

Nếu Backend cũ đang chạy, dùng Ctrl+C tại terminal của nó rồi chạy lại để nạp code mới; không khởi động trùng. Khi cổng trống:

```powershell
npm.cmd start
# Hoặc npm.cmd run dev
```

Kiểm tra từ terminal khác:

```powershell
curl.exe -i http://127.0.0.1:3000/api/health
curl.exe -i "http://127.0.0.1:3000/api/products?page=1&limit=3&q=SP"
curl.exe -i http://127.0.0.1:3000/api/products/SP001
curl.exe -i http://127.0.0.1:3000/api/inventory/SP001
curl.exe -i "http://127.0.0.1:3000/api/transactions?movementType=OUT&productId=SP001"
curl.exe -i http://127.0.0.1:3000/api/scan-points
```

Health chỉ chứng minh DB chạy SELECT 1, không thay thế preflight/integration các bảng.

## 4. REST API và tương thích

[Hợp đồng REST API cho React + Ant Design](docs/REST_API.md) mô tả request, response, query, status và phân trang.

GET: /api/health, /api/products, /api/products/:id, /api/inventory, /api/inventory/:productId, /api/transactions, /api/scan-points.

Giữ data/count và các trường products; thêm pagination. count là số hàng trong trang, pagination.total là tổng khớp bộ lọc. Mặc định page=1, limit=20, tối đa 100; products không còn trả toàn bộ bảng trong một response. bigint là chuỗi, timestamp ISO 8601 UTC. SQL chọn cột rõ ràng, values có tham số, schema được escape; không JOIN users hoặc trả user_id.

## 5. Chức năng từng file

| File | Chức năng |
| --- | --- |
| src/server.js | Khởi động HTTP, lỗi listen/SIGINT/SIGTERM; giữ lifecycle giai đoạn 1 |
| src/app.js | Ghép router, query parser, no-store, 404 và error handler |
| src/config/env.js | .env, kiểm tra cấu hình/role, giới hạn host loopback |
| src/db/pool.js | pg.Pool và lỗi idle, không log bí mật |
| src/lifecycle.js | Đợi HTTP đóng trước khi kết thúc pool |
| src/http/errors.js | HttpError 400/404 có code/message an toàn |
| src/http/query.js | Validation query/path/pagination và tìm kiếm literal |
| src/middleware/error-handler.js | JSON lỗi 400/404/500/503, log code/type |
| src/routes/health.js | SELECT 1 mỗi request, giữ response giai đoạn 1 |
| src/routes/products.js | Danh sách/tìm kiếm/phân trang và chi tiết/units |
| src/routes/inventory.js | Danh sách và chi tiết tồn kho |
| src/routes/transactions.js | Lịch sử với bộ lọc sản phẩm, IN/OUT, điểm quét |
| src/routes/scan-points.js | Danh sách điểm quét |
| src/repositories/read.js | SQL chỉ đọc, JOIN theo FK, count/page cùng snapshot; giữ bigint |
| scripts/check-db.js | Kiểm tra kết nối/products giai đoạn 1 |
| scripts/check-phase2-access.js | CLI preflight, exit 1 khi thiếu quyền/cấu hình |
| scripts/lib/phase2-access.js | Identity/quyền, probe tên/kiểu cột LIMIT 0 |
| scripts/grant-phase2-readonly.sql | Cấp SELECT thủ công bốn bảng, không tự chạy |
| scripts/verify-phase2-readonly.sql | Kiểm tra quyền catalog, không thử ghi |
| scripts/create-warehouse-readonly.sql | File kiểm tra role hiện có của người dùng |
| scripts/verify-warehouse-readonly.sql | Kỳ vọng quyền lịch sử giai đoạn 1 |
| test/api.test.js | Giữ mục tiêu hồi quy giai đoạn 1, cập nhật assertion đã duyệt |
| test/config.test.js | Cấu hình và chặn bind ngoài localhost |
| test/read-api.test.js | API mới, validation, SQL parameters, snapshot/bigint, projection/lỗi |
| integration/database.test.js | Health/products thật, duyệt đủ các trang |
| integration/read-api.test.js | Đối chiếu từng API với dữ liệu thật; xuất báo cáo JSON |
| integration/support/audit.js | Hash/count năm bảng và metadata/function trước/sau |
| docs/REST_API.md | Tài liệu dùng API cho Frontend |
| docs/SCHEMA_PHASE2.md | Schema thực tế và fingerprint function |
| docs/PHASE2_PLAN.md | Thiết kế đã duyệt, baseline trước triển khai |
| docs/phase2-verification.json | Kết quả/hash gần nhất khi integration chạy tới phần báo cáo |
| .env / .env.example / .gitignore | Cấu hình bí mật / mẫu không mật khẩu / loại bí mật và dependencies khỏi Git |
| package.json / package-lock.json | Lệnh/dependencies / khóa phiên bản; không thêm dependency ở giai đoạn 2 |

## 6. Kết quả và giới hạn

Xác minh giai đoạn 2 ngày 03/11/2026: PostgreSQL 17.11, warehouse_readonly, quyền PASS; **36/36 unit/regression**, **10/10 integration**. Bảy endpoint kể cả health được gọi thật và đối chiếu. Dữ liệu: 10 products, 18 product_units, 10 inventory, 2 transactions (1 IN, 1 OUT), 2 scan_points. [Báo cáo JSON](docs/phase2-verification.json) chứa hash và mã/số lượng đã xác minh.

SP001 tồn "145"; giao dịch OUT đã lưu 15 gói, snapshot=1, quantity_base="15", inventory_after="145". Hash dữ liệu năm bảng, metadata sáu bảng và định nghĩa function khớp trước/sau test. Không đọc dữ liệu users hoặc thay mật khẩu/quyền.

Hai nhánh chưa có dữ liệu thật: sản phẩm tồn tại nhưng thiếu inventory; snapshot lịch sử khác factor hiện tại. Có unit test cho các nhánh này, không sửa dữ liệu để tạo tình huống. Transactions chỉ có hai hàng, chưa kiểm chứng hiệu năng dữ liệu lớn.

Chưa có API ghi, đăng nhập/phân quyền, API users, frontend, CORS, sort tùy chọn, lọc thời gian, migration/index mới. Có thể đọc cả sản phẩm/điểm quét is_active=false. Frontend dùng cùng origin hoặc dev proxy localhost; không mở bind ngoài localhost.

Lỗi thường gặp: 28P01 sai thông tin xác thực; ECONNREFUSED host/port/dịch vụ; 42501 thiếu SELECT/USAGE; 42P01/42703 schema khác đã kiểm tra; 57014 timeout; EADDRINUSE cổng đã bị chiếm. HTTP chỉ trả lỗi chung, log không chứa password/SQL/connection string. Nếu hash khác do thay đổi đồng thời, dừng kết luận bất biến và kiểm tra lại lúc ổn định.
