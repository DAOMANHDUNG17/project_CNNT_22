# Kế hoạch giai đoạn 2 — đã được người dùng phê duyệt

Ngày phân tích: 03/11/2026. Người dùng đã phê duyệt hợp đồng, phân trang và cập nhật assertion hồi quy. Nội dung dưới lưu thiết kế và baseline tại thời điểm lập kế hoạch; kết quả triển khai xem README, REST_API.md và phase2-verification.json.

## 1. Hiện trạng đã kiểm tra

- Đã đọc README, toàn bộ `src`, `scripts`, `test`, `integration`, package.json, .env.example và .gitignore. Không in mật khẩu .env.
- Kết nối thật bằng `warehouse_readonly` tới `smart_warehouse`, PostgreSQL 17.11, transaction chỉ đọc.
- Đã xác minh đầy đủ tên cột, kiểu dữ liệu, nullable/default/generated, PK, FK, CHECK, UNIQUE, index và trạng thái RLS của sáu bảng qua pg_catalog. Chi tiết tại [SCHEMA_PHASE2.md](SCHEMA_PHASE2.md).
- `npm.cmd run check:db`: PASS. `npm.cmd run test:integration`: PASS 1/1, đối chiếu 10 sản phẩm. `npm.cmd test`: PASS 16/16. Đây là baseline giai đoạn 1 trước thay đổi.
- SELECT hiện tại: chỉ products. Chưa SELECT product_units/inventory/stock_transactions/scan_points. Không SELECT users; không đọc dữ liệu người dùng.
- README có thông tin lịch sử chưa cập nhật: vẫn ghi thiếu mật khẩu/integration chưa đạt; mô tả script tạo role không còn khớp nội dung file thực tế. `create-warehouse-readonly.sql` hiện chỉ là SELECT kiểm tra role do người dùng chỉnh; giữ nguyên file này, không khôi phục lệnh tạo tài khoản.
- Config mặc định bind 127.0.0.1 nhưng hiện chưa từ chối HOST khác localhost. Đề xuất bổ sung validation loopback ở bước triển khai, không thay .env.

## 2. Cấp quyền thủ công — không thực hiện tự động

Hai file mới:

- `scripts/grant-phase2-readonly.sql`: BEGIN → kiểm tra đúng database/role/sáu bảng → GRANT SELECT đúng bốn bảng → kiểm tra quyền hiệu lực → COMMIT. Không tạo role, đổi mật khẩu, thay role attributes/membership, cấp quyền users/sequence/default privileges hoặc thay function/schema/data.
- `scripts/verify-phase2-readonly.sql`: chỉ SELECT catalog để kiểm tra quyền, có bảng chi tiết và kết quả tổng hợp `phase2_permissions=PASS/FAIL`. PASS quyền không đồng nghĩa PASS API.

Lệnh cấp quyền cốt lõi:

```sql
GRANT SELECT ON TABLE
  public.product_units,
  public.inventory,
  public.stock_transactions,
  public.scan_points
TO warehouse_readonly;
```

Trong pgAdmin 4 sau khi duyệt kế hoạch:

1. Kết nối bằng tài khoản quản trị có quyền cấp SELECT trên bốn bảng. Tài khoản quản trị chỉ dùng trong pgAdmin, Backend tiếp tục dùng warehouse_readonly.
2. Chọn **Databases → smart_warehouse → Query Tool**; mở `D:\Project_CNNT\scripts\grant-phase2-readonly.sql`.
3. Bỏ mọi vùng chọn và Execute Script/F5 để chạy toàn bộ file. Xác nhận COMMIT thành công. Nếu lỗi, chạy `ROLLBACK;` trong cùng Query Tool. Script chỉ bổ sung SELECT, không tự sửa các quyền sai phát hiện trong kiểm tra.
4. Mở và chạy toàn bộ `scripts/verify-phase2-readonly.sql` trong smart_warehouse. SELECT phải true cho năm bảng nghiệp vụ, false cho users và mọi cột users; các quyền ngoài SELECT, quyền cấp lại SELECT, CREATE database/schema đều false; không có membership/quyền quản trị. Dòng cuối phải PASS.
5. Báo đã hoàn tất cấp quyền để kiểm thử lại bằng tài khoản ứng dụng. Không cần đổi .env hoặc mật khẩu.

Đã chạy file verification bằng warehouse_readonly trước cấp quyền: SQL thực thi thành công, kết quả `phase2_permissions=FAIL`, đúng bốn bảng `inventory`, `product_units`, `scan_points`, `stock_transactions` cần bổ sung SELECT. Chưa chạy script GRANT; script cấp quyền mới được rà soát nội dung, chưa kiểm chứng bằng thực thi. Không chạy integration mới phụ thuộc các bảng đó khi preflight chưa đạt, không dùng tài khoản quản trị làm phương án thay thế.

Script kiểm tra phạm vi sáu bảng, database/schema và role, không kiểm toán toàn bộ cluster hay các function khác. Quyền PUBLIC được tính trong quyền hiệu lực; script sẽ abort thay vì REVOKE quyền PUBLIC có thể ảnh hưởng tài khoản khác.

## 3. Hợp đồng REST API đề xuất

Base URL: `http://127.0.0.1:3000/api`. Giữ nguyên URL/response health. Tên trường dữ liệu theo snake_case của database; query parameters dùng tên trong bảng dưới.

| Endpoint GET | Query parameters | Kết quả và nguồn dữ liệu |
| --- | --- | --- |
| `/products` | `page`, `limit`, `q` | Các cột products hiện có; tìm tên hoặc mã sản phẩm; sắp xếp product_id ASC |
| `/products/:id` | Không | Một products kèm `units` từ product_units qua product_id; units sắp xếp product_unit_id ASC |
| `/inventory` | `page`, `limit` | Các hàng inventory thật JOIN products qua product_id; sắp xếp product_id ASC |
| `/inventory/:productId` | Không | Một hàng inventory kèm tên/base_unit/is_active sản phẩm; không tự suy diễn số tồn nếu thiếu hàng |
| `/transactions` | `page`, `limit`, `productId`, `movementType`, `scanPointId` | Lịch sử JOIN products, product_units, scan_points; lọc kết hợp bằng AND; sắp xếp created_at DESC, transaction_id DESC |
| `/scan-points` | `page`, `limit` | scan_point_id, point_name, is_active; sắp xếp scan_point_id ASC |

Validation và phân trang:

- page mặc định 1, limit mặc định 20, limit tối đa 100. Số phải là số nguyên dương, offset trong giới hạn số nguyên an toàn. limit vượt 100 trả 400, không âm thầm thay đổi.
- q nếu có phải là chuỗi không rỗng sau trim, tối đa 150 ký tự; tìm substring không phân biệt hoa/thường trên product_id hoặc product_name. Escape ký tự wildcard `%`, `_`, `\` để chúng được tìm như ký tự thường, truyền giá trị qua `$n`.
- productId, scanPointId và path ID phải là chuỗi không rỗng, tối đa 20 ký tự theo schema đã kiểm tra. Không giới hạn cứng theo mẫu SPxxx vì schema không yêu cầu mẫu đó.
- movementType chỉ nhận chính xác IN hoặc OUT; giá trị sai trả 400. Không truyền tên cột, ORDER BY hoặc đoạn SQL từ request vào truy vấn.
- Query không hỗ trợ, query lặp/array/object trả 400 để tránh bỏ lọt bộ lọc và input mơ hồ.
- Không có kết quả danh sách: 200 với data=[] và total=0. Trang vượt tổng số: 200 với data=[], total vẫn là tổng số khớp bộ lọc.

Mẫu cấu trúc response danh sách, chỉ minh họa hợp đồng, không phải dữ liệu thực tế:

```json
{
  "data": [],
  "count": 0,
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

`count` tiếp tục nghĩa là số hàng trong data của response. `pagination.total` là tổng số khớp bộ lọc, không phải count của trang. Tổng và trang dữ liệu được đọc trong cùng snapshot/một statement để tránh lệch trong một response. Dùng số an toàn cho metadata phân trang; không ép bigint nghiệp vụ sang JavaScript Number.

Chi tiết trả `{ "data": { ... } }`. Lỗi giữ `{ "error": { "code": "...", "message": "..." } }`; không trả SQL, stack trace, credentials.

| Endpoint | Trường data dự kiến |
| --- | --- |
| products list | product_id, product_name, base_unit, is_active, created_at (giữ các trường hiện tại) |
| product detail | Các trường products và units[]: product_unit_id, product_id, unit_name, conversion_factor, scan_code, is_base_unit |
| inventory list/detail | product_id, product_name, base_unit, is_active, quantity_base, updated_at |
| transactions | transaction_id, product_id, product_name, product_unit_id, unit_name, scan_point_id, point_name, movement_type, quantity_packages, conversion_factor_snapshot, quantity_base, inventory_after, created_at |
| scan-points | scan_point_id, point_name, is_active |

Mọi cột bigint (product_unit_id, quantity_base, inventory_after) trả chuỗi để giữ độ chính xác; integer/boolean vẫn là JSON number/boolean; timestamp trả ISO 8601. Transaction quantity_base lấy từ cột generated hiện có, conversion_factor_snapshot lấy từ transaction, không dùng factor hiện tại để tính lại lịch sử.

JOIN transaction với product_units phải dùng **cả product_unit_id và product_id** đúng FK kép. Không JOIN users; không SELECT user_id, username, display_name, password_hash hoặc role cho response.

| HTTP status | Trường hợp |
| --- | --- |
| 200 | Danh sách, chi tiết, danh sách rỗng |
| 400 | Query/path không hợp lệ, movementType ngoài IN/OUT |
| 404 PRODUCT_NOT_FOUND | Không có sản phẩm khi gọi chi tiết products hoặc inventory theo mã |
| 404 INVENTORY_NOT_FOUND | Sản phẩm tồn tại nhưng không có hàng inventory; không tự trả tồn 0 |
| 404 NOT_FOUND | URL/phương thức chưa hỗ trợ, giữ hành vi giai đoạn 1 |
| 500 INTERNAL_SERVER_ERROR | Lỗi SQL/quyền/cấu hình phía server, thông điệp công khai chung |
| 503 DATABASE_UNAVAILABLE | DB lỗi kết nối, timeout hoặc không sẵn sàng, giữ phân loại hiện tại |

Health giữ `{"status":"ok","database":"connected"}` khi thành công và 503 khi truy vấn lỗi như giai đoạn 1. Danh sách bao gồm cả bản ghi is_active=false; chưa có yêu cầu tự ẩn sản phẩm/điểm quét ngừng hoạt động.

## 4. Tương thích và thay đổi đã được duyệt

- Giữ GET /api/health và các trường products hiện có, data/count, xử lý lỗi an toàn, pg.Pool và lifecycle.
- Products sẽ có thứ tự ổn định và giới hạn trang thay vì trả mọi hàng. Khi không có query, mặc định chỉ tối đa 20 sản phẩm. Với 10 sản phẩm hiện tại, data/count vẫn đủ 10; response thêm pagination.
- Một số test giai đoạn 1 đang assert đúng chuỗi `SELECT *` và deep-equal toàn bộ `{data,count}`. Phân trang/SELECT cột rõ ràng làm các assertion này cần cập nhật. Đề xuất giữ đầy đủ mục tiêu hồi quy (nguồn DB, empty/error, schema escaping, shutdown, phương thức ghi), cập nhật assertion theo hợp đồng mới, không xóa bài test hoặc giảm coverage. Đây là thay đổi test có chủ đích cần phê duyệt, không thể giữ nguyên từng assertion SQL cũ đồng thời thay truy vấn phân trang.
- Integration cũ đối chiếu toàn bộ bảng với một response: sẽ mở rộng đi qua tất cả trang và so sánh toàn bộ mã/dữ liệu, không phụ thuộc việc database mãi chỉ có 10 sản phẩm.

Các file dự kiến sau phê duyệt:

| File | Thay đổi/chức năng |
| --- | --- |
| src/app.js | Gắn inventory, transactions, scan-points routers |
| src/routes/products.js | Thêm tìm kiếm/phân trang và /:id |
| src/routes/inventory.js | Danh sách và chi tiết tồn kho |
| src/routes/transactions.js | Danh sách giao dịch và bộ lọc |
| src/routes/scan-points.js | Danh sách điểm quét |
| src/repositories/*.js | SQL đọc với cột rõ ràng, JOIN đúng FK, tham số và thứ tự ổn định |
| src/http/query.js | Validation query/path, pagination và escape tìm kiếm dùng chung |
| src/http/errors.js | Lỗi 400/404 có code/message an toàn |
| src/middleware/error-handler.js | Hỗ trợ lỗi 400/404 chủ động, giữ phân loại lỗi DB cũ |
| src/config/env.js | Chỉ chấp nhận HOST loopback (127.0.0.1, ::1, localhost); không thay .env |
| scripts/check-phase2-access.js | Preflight quyền/schema bằng tài khoản ứng dụng; không cấp quyền |
| package.json | Thêm lệnh check:phase2; không cần dependency mới |
| test/*.test.js | Giữ mục tiêu baseline, thêm bài test validation, phân trang, filter, JOIN, 404 và bảo mật |
| integration/*.test.js | Hồi quy products/health và integration mới đọc DB thật |
| README.md | Cập nhật tiến độ thật, kiến trúc/file, chạy/cấp quyền/test, giới hạn chưa làm |
| docs/REST_API.md | Request/response/status/query, phân trang Ant Design và lưu ý bigint cho React |

Không thay src/server.js nếu không cần cho wiring; không thay pg.Pool/lifecycle đã hoạt động ngoài nhu cầu được giải thích. Không thay lockfile nếu không đổi dependencies.

## 5. Thứ tự thực hiện sau phê duyệt

1. Người dùng chạy script cấp SELECT thủ công và xác nhận đã hoàn tất; kiểm tra lại quyền bằng warehouse_readonly.
2. Xây validation/repositories/routes theo thiết kế, bổ sung preflight và tests. SQL đều đọc, tất cả request values dùng parameters; schema cấu hình được escape riêng.
3. Chạy unit và hồi quy toàn bộ giai đoạn 1 theo hợp đồng đã duyệt. Không dùng mock trong API runtime.
4. Preflight DB thật. Nếu thiếu SELECT, dừng integration liên quan và báo bảng thiếu; chờ người dùng cấp đúng quyền rồi chạy lại. Không fallback tài khoản quản trị, không seed hoặc sửa dữ liệu.
5. Integration thật chạy trên HTTP port tạm chỉ bind 127.0.0.1; không khởi động trùng cổng 3000. Nếu cần thử server chính, kiểm tra port trước, không tự dừng tiến trình của người dùng.
6. Đối chiếu từng trang và chi tiết sản phẩm/units, tồn kho với SELECT trực tiếp; đối chiếu transaction IDs, IN/OUT, đơn vị, snapshot, số lượng, inventory_after và từng bộ lọc với SQL trực tiếp. Chọn bản ghi thật sau khi có quyền, không giả định trước số giao dịch/điểm quét.
7. Kiểm tra 400, 404, danh sách rỗng, phân trang vượt cuối và SQL Injection; kiểm tra response không có dữ liệu người dùng. Nếu DB không có hàng để kiểm chứng một nhánh, ghi rõ chưa có dữ liệu kiểm chứng; chỉ unit cho nhánh đó, không đánh dấu integration PASS giả.
8. Mọi session test đặt read-only. Ghi nhận hash/count dữ liệu của năm bảng được phép đọc trước/sau và fingerprint schema/hàm record_stock_movement() bằng metadata chỉ đọc. Không gọi hàm hoặc sửa users. Nếu có thay đổi đồng thời từ ứng dụng khác, báo phép đối chiếu bị ảnh hưởng và kiểm tra lại, không suy đoán nguyên nhân. Không thử INSERT/UPDATE/DELETE kể cả để rollback.
9. Xuất báo cáo PASS/FAIL theo từng endpoint cùng số liệu thật, test commands, trạng thái quyền và hạn chế; cập nhật README/REST_API.

Tài liệu React + Ant Design sẽ mô tả `rowKey=product_id/transaction_id/scan_point_id`, mapping `pagination.current/pageSize/total` sang page/limit/total và cách giữ bigint dạng chuỗi. Chưa triển khai frontend/CORS; dùng cùng origin hoặc dev proxy localhost theo hướng dẫn tài liệu, không mở bind ra LAN.

## 6. Ngoài phạm vi

Không API ghi, nhập/xuất, đăng nhập, đọc users, sửa 6 bảng, seed/reset, sửa record_stock_movement(), đổi tài khoản/mật khẩu, sửa pg_hba.conf hoặc quyền PUBLIC; không triển khai frontend, migration, thêm index hoặc mở mạng ngoài localhost.

Trạng thái sau triển khai: quyền được người dùng cấp thủ công và đã xác minh bằng warehouse_readonly. 36/36 unit/regression và 10/10 integration thật đạt; bảy endpoint kể cả health được kiểm thử. Dữ liệu năm bảng được đọc, schema sáu bảng và định nghĩa hàm khớp trước/sau. Xem phase2-verification.json về số liệu và các nhánh chưa có dữ liệu thật; không sửa dữ liệu để tạo tình huống kiểm thử.
