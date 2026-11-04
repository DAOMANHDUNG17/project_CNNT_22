# Backend readiness — Smart Stationery Warehouse

Ngày nghiệm thu: **04/11/2026, Asia/Bangkok**. Phạm vi: chốt Backend hiện có để phát triển React + TypeScript + Ant Design, không bổ sung tính năng ngoài 29 operations.

## Kết luận

**GO cho phát triển và tích hợp Frontend trên môi trường test độc lập. NO-GO cho Backend mới kết nối database chính ở trạng thái hiện tại.**

- **29/29 HTTP operations** đã có request thành công thật, qua chính TypeScript client tới Express, PostgreSQL test và Redis. Không phát hiện operation thiếu, sai route, chưa mount hoặc thiếu phương thức client trong phạm vi OpenAPI.
- **78/78 unit/regression**, **29/29 integration Backend mới**, **10/10 legacy integration** PASS ở các lần chạy cuối. Hai nhóm unit riêng là 31 legacy và 47 Backend/config/contract; không cộng lại chúng lần nữa vào tổng 78.
- Database chính kiểm tra kết nối/baseline đọc PASS nhưng **readiness cho Backend mới FAIL**: thiếu cột, role, function và ACL. Không áp migration, cấp quyền, sửa dữ liệu/password/hash trên main.
- API contract đã được kiểm tra để bắt đầu Frontend; trước khi dùng main vẫn cần rollout database và credential riêng, rồi kiểm tra lại môi trường đích.

Bằng chứng có thể đọc bằng máy: [29 API](docs/backend-api-verification.json), [main catalog inspection](docs/backend-main-inspection.json), [legacy data/schema/function audit](docs/phase2-verification.json).

## Môi trường và cách hiểu số lượng API

Node.js thực thi: **v24.15.0**. PostgreSQL chính: **17.11**, 127.0.0.1:5432 / smart_warehouse, đăng nhập warehouse_readonly, transaction_read_only=on.

Integration ghi chỉ chạy với 127.0.0.1:5433 / **smart_warehouse_phase3_test** và Redis test 127.0.0.1:6379. Guard kiểm tra database, cổng/host, marker `phase3.environment=isolated-test-v1`, cluster không có database smart_warehouse, reader/writer identity và Redis test configuration. Hạ tầng là hai container đã tồn tại; khởi động Docker Desktop làm chúng hoạt động lại. Không tạo lại/reset database, không chạy bootstrap/migration trong đợt này.

OpenAPI có **24 path templates / 29 operations**. Nhóm Auth 4, Products/Units 7, Inventory 3, Transactions 3, Scan Points 3, Users 5, Dashboard 3, Health 1. Con số 29 bài integration là số case do Node test runner báo, khác khái niệm 29 operations, dù cùng giá trị.

29/29 được xác minh trên **test**, không phải main. Bảy route đọc legacy được gọi thật trên main qua factory regression riêng; điều này không chứng minh server Auth/Admin mới chạy trên main. `.env` chính vẫn được giữ nguyên và chưa có đầy đủ cấu hình writer/Redis; dùng APP_ENV_FILE riêng cho test.

## Từng operation đã gọi thành công

Mỗi dòng có ít nhất một HTTP 2xx đúng hợp đồng, không chỉ chứng minh route trả 401/403. Response JSON được kiểm tra required fields, kiểu dữ liệu, enum/const, giới hạn số/độ dài, pattern, format và additionalProperties theo các schema keyword hiện dùng trong OpenAPI. Validator từ chối keyword mới chưa hỗ trợ; đây không phải chứng nhận toàn bộ OpenAPI bằng một bộ validator chuẩn bên ngoài.

| Method | Route | Status quan sát qua typed client | Kết quả |
| --- | --- | --- | --- |
| GET | /api/auth/csrf | 200, 401 | PASS |
| POST | /api/auth/login | 200 | PASS |
| POST | /api/auth/logout | 204 | PASS |
| GET | /api/auth/me | 401, 200 | PASS |
| GET | /api/dashboard/stock-trends | 200 | PASS |
| GET | /api/dashboard/summary | 200 | PASS |
| GET | /api/dashboard/top-products | 200 | PASS |
| GET | /api/health | 200 | PASS |
| GET | /api/inventory | 200 | PASS |
| GET | /api/inventory/{productId} | 200 | PASS |
| GET | /api/inventory/low-stock | 200 | PASS |
| GET | /api/products | 200 | PASS |
| POST | /api/products | 201 | PASS |
| GET | /api/products/{id} | 200 | PASS |
| PATCH | /api/products/{id} | 200 | PASS |
| PATCH | /api/products/{id}/status | 200 | PASS |
| POST | /api/products/{id}/units | 201 | PASS |
| PATCH | /api/product-units/{id} | 200, 409 | PASS |
| GET | /api/scan-points | 200 | PASS |
| POST | /api/scan-points | 201 | PASS |
| PATCH | /api/scan-points/{id} | 200 | PASS |
| GET | /api/transactions | 200 | PASS |
| POST | /api/transactions | 201, 200 | PASS |
| GET | /api/transactions/{id} | 200 | PASS |
| GET | /api/users | 200 | PASS |
| POST | /api/users | 201 | PASS |
| PATCH | /api/users/{id} | 200 | PASS |
| POST | /api/users/{id}/reset-password | 200 | PASS |
| PATCH | /api/users/{id}/status | 200 | PASS |

Chi tiết contract còn kiểm tra đủ **26 operations yêu cầu session** trả 401 khi không có cookie. Login/health công khai; logout chấp nhận thiếu phiên để xóa cookie cũ, nhưng phiên hợp lệ vẫn cần CSRF. `/inventory/low-stock` được gọi thật và không bị route `/inventory/:productId` che mất.

CRUD Admin theo contract gồm create/read/update/status/reset-password; không có hard DELETE hoặc DELETE unit trong 29 operations. Vô hiệu hóa product/user dùng status, scan point dùng is_active. Không tự thêm endpoint xóa hoặc chức năng ngoài phạm vi.

## Kết quả kiểm thử

| Hạng mục / lệnh | Trạng thái cuối | Kết quả và phạm vi |
| --- | --- | --- |
| npm.cmd test | PASS | 78/78; DB/Redis doubles, không coi là bằng chứng kết nối thật |
| npm.cmd run test:legacy-unit | PASS | 31/31; factory đọc cũ, projection, query validation/parameterization, bigint, lỗi an toàn, lifecycle |
| npm.cmd run test:backend-unit | PASS | 47/47; Auth, password, Redis contract, config, admin/dashboard, stock retries/unknown commit, OpenAPI/client, startup policy |
| npm.cmd run test:integration | PASS | 29/29; PostgreSQL test và Redis thật, gồm 29 operations và entry point server.js |
| npm.cmd run test:all | PASS | Unit + integration Backend mới; không phụ thuộc preflight/main legacy |
| npm.cmd run test:legacy-integration | PASS | 10/10; main chỉ đọc; bảy API legacy đối chiếu dữ liệu thật |
| npm.cmd run check:db | PASS | Login reader, PostgreSQL 17.11, read-only, SELECT products |
| npm.cmd run check:phase2 | PASS | Identity và ACL của baseline đọc hiện có |
| scripts/admin-dashboard/20-verify-admin-readonly.psql trên test | PASS | ADMIN_METADATA_PASS; BEGIN READ ONLY / ROLLBACK |
| npm.cmd run check:main | FAIL | Main thiếu điều kiện cho Backend mới; exit 1 có chủ ý, chi tiết bên dưới |
| Bootstrap lại test database | SKIPPED | Đã có test DB hợp lệ; không reset/ghi đè schema/credential chỉ để chạy kiểm thử |
| CRUD/Auth mutation/GRANT/migration trên main | SKIPPED | Theo yêu cầu không sửa dữ liệu/quyền trên main; writer role còn chưa tồn tại |
| Đăng nhập writer và kiểm tra credential Redis riêng của main | SKIPPED | Main chưa có writer role và cấu hình writer/Redis riêng; không mượn tài khoản test hoặc postgres làm runtime |
| TypeScript tsc --noEmit / frontend build | SKIPPED | Repo chưa có TypeScript compiler/React project; client .ts đã được Node 24 thực thi thật, nhưng type stripping không thay thế strict type-check |
| Cắt mạng thật ngay lúc COMMIT | SKIPPED | Không thực hiện fault injection kết nối tại thời điểm commit; nhánh outcome unknown có unit regression, retry UUID có integration thật |

Các log lệnh nằm tại `backend-readiness-tests.log`, `legacy-unit-readiness.log`, `backend-unit-readiness.log`, `legacy-readiness.log` trong workspace; *.log không commit. Kết quả cuối tổng cộng **117 case PASS** = 78 unit + 29 integration mới + 10 legacy, không tính các lệnh preflight là test case.

### Auth, Redis, CSRF và RBAC

- Bốn role ADMIN/KEEPER/STAFF/VIEWER đăng nhập bằng Argon2id thật; response chỉ có identity, không password/hash/session token. Unknown/inactive/no-hash/wrong-password cùng lỗi 401 an toàn.
- Cookie opaque HttpOnly/SameSite=Lax; login xoay token, logout thu hồi; Redis Lua thực thi thật cho idle expiry và absolute lifetime. Cờ Secure/prefix HTTPS và production HTTPS origin được kiểm tra unit/config.
- Thiếu/sai CSRF, token của phiên khác, Origin không được phép và actor/role do client tự khai báo đều bị từ chối. Các thay đổi role/status/password thu hồi hiệu lực phiên qua auth_version đọc từ PostgreSQL mỗi request.
- ADMIN quản trị catalog/users; KEEPER nhập/xuất; STAFF chỉ xuất; VIEWER không ghi. Non-admin không đọc Users. Có kiểm tra HTTP thật và lớp function/ACL trên PostgreSQL test.
- Rate limit thật trả 429/Retry-After; health ACL chỉ PING và không đọc/ghi session; session ACL từ chối key ngoài namespace và CONFIG. Ngắt riêng Redis client của test làm Auth trả 503 SESSION_STORE_UNAVAILABLE, health DB vẫn 200.
- Reader không SELECT users hoặc gọi business function. Reader session chặn write bằng 25006; khi chủ động BEGIN READ WRITE **trên test**, ACL độc lập vẫn chặn bằng 42501. Writer không INSERT/UPDATE trực tiếp vào bảng kho/users.
- Preflight kiểm tra exact function signature/owner/DEFINER/search_path, EXECUTE giới hạn, reader isolation, executor NOLOGIN/không membership và quyền runtime nguy hiểm. Runtime chỉ hỗ trợ schema public và từ chối cấu hình khác ngay từ đầu.

### CRUD, nhập/xuất, idempotency và concurrency

- Product/unit/scan point/user create và update thật, inventory khởi tạo 0, status/reset-password thật. Không để lộ password_hash/auth_version/user_id actor trong response không được phép.
- Unit cũ giữ conversion_factor/is_base_unit/scan_code/product binding; thay ý nghĩa bị 409, rename hợp lệ. Product base_unit đã có unit/history không được đổi.
- Nhập theo factor và xuất ra đúng quantity_base/inventory_after; transaction detail giữ snapshot lịch sử. Duplicate UUID đồng thời trả một 201 và một 200, chỉ một hàng/delta; khác payload hoặc khác scan point với cùng UUID bị 409. Replay giữ inventory_after lịch sử cả sau giao dịch mới/vô hiệu product.
- **Hai connection PostgreSQL khác pg_backend_pid()** cùng xuất 80 trên tồn 100: một CREATED, một PZ010/insufficient stock; tồn cuối 20, không xuất âm, không thêm transaction thất bại.
- Hai connection khác nhau thực hiện user writes; quan sát connection thứ hai chờ advisory lock qua pg_stat_activity. Kiểm tra last active ADMIN không thể bị demote và rollback fixture thay đổi.
- Dashboard/list/detail/bộ lọc chạy thật; summary tách lượng theo base_unit, top-products dùng số lượng lịch sử, không cộng các đơn vị khác loại.

## Lỗi đã sửa và hồi quy được giữ lại

1. **Lỗi client thực tế:** send() truyền nguyên options có `csrf:true` sang csrf(); csrf() lại gọi send(), gây Maximum call stack size exceeded khi token chưa có. Đã chỉ truyền signal sang request lấy token. Có regression cho thao tác ghi đầu tiên và integration logout khi mất phiên.
2. **OpenAPI lệch hành vi:** Error schema additionalProperties=false không cho `error.transaction_id` mà runtime trả khi COMMIT chưa xác định kết quả. Đã thêm field UUID tùy chọn; không đổi giao thức API và giữ schema chặt với field khác.
3. **Assertion quyền sai:** test kỳ vọng 42501 trong session read-only, thực tế PostgreSQL chặn trước bằng 25006. Đã kiểm tra cả hai hàng rào riêng, không đổi assertion thành chấp nhận lỗi tùy ý.
4. **Tách suite:** trước đây test:integration phụ thuộc main phase-2 preflight và gom cả hai kiến trúc. Nay lệnh mặc định chỉ chạy Backend mới trên test; legacy-unit/legacy-integration là lệnh riêng. test:all không cần main sẵn sàng để nghiệm thu Backend mới.
5. **Checksum cũ không còn là điều kiện hợp lệ cho mọi phiên bản:** legacy test giữ chữ ký function và kiểm tra hash trước/sau bất biến trong mỗi lần chạy, thay việc khóa mọi phiên bản vào checksum trước hardening. Các hash dữ liệu/metadata, kiểm tra read-only/projection/history vẫn giữ. Guard baseline checksum trong migration test không bị bỏ.
6. **Startup policy:** trước đây function có thể dùng nhầm owner trong hai executor hoặc PGSCHEMA khác public dù preflight kiểm tra public. Đã kiểm tra owner tương ứng chính xác, signature, toàn bộ search_path settings, EXECUTE ACL và từ chối schema không được runtime hỗ trợ; thêm regression.
7. **Test isolation:** chạy lặp suite từng tiêu hết rate budget 15 phút của IP/tài khoản fixture, làm login trả 429 đúng policy nhưng test báo fail. Đã dọn đúng counter fixture trên Redis test trước từng fixture, giữ nguyên rate limit runtime. Không FLUSHDB, không xóa phiên hàng loạt. Helper đăng ký cleanup sớm và giới hạn thời gian kết nối Redis để lỗi hạ tầng không giữ pool/process treo.
8. **Tài liệu/môi trường:** README thay mô tả chỉ đọc giai đoạn 2 bằng kiến trúc hiện tại; .env.example có reader/writer/Redis secret hoặc *_FILE, cookie policy, ALLOWED_ORIGINS và APP_ENV_FILE, không có password thật. `.env` chính không đổi.

Lịch sử chạy được phân biệt với kết quả cuối: lần đầu integration FAIL vì Docker/5433/6379 chưa chạy; sau khi khởi động lại container hiện có thì chạy được. Assertion ACL và lỗi client nêu trên đã được tái hiện/sửa/test lại. Có một lần runner legacy thoát ở cấp file, không cung cấp stack khi nhiều lệnh chạy đồng thời; chạy riêng bằng TAP và chạy lại npm script đều PASS, chưa xác định được nguyên nhân lần thoát đó. Theo dõi nếu tái diễn, không diễn giải nó thành lỗi dữ liệu/database.

## Database chính: kết quả truy vấn chỉ đọc

Nguồn: `scripts/check-backend-main.js` với reader warehouse_readonly, BEGIN READ ONLY, catalog/has_*_privilege/pg_get_functiondef để checksum, kết thúc ROLLBACK. Không SELECT dữ liệu users, không gọi record_stock_movement/admin_dashboard_write.

| Thành phần | Hiện trạng main | Phần còn chờ |
| --- | --- | --- |
| Sáu bảng nghiệp vụ public | Có; baseline read PASS | Giữ bảng/dữ liệu/constraint/history hiện có |
| warehouse_readonly | Có; CONNECT/SELECT năm bảng; không SELECT users/DML | Thu hẹp quyền legacy còn dư, gồm TEMP và EXECUTE được thừa hưởng từ PUBLIC |
| warehouse_backend | Không có | Tạo runtime LOGIN riêng, quyền SELECT hẹp và EXECUTE hai function; không DML trực tiếp |
| warehouse_stock_executor | Không có | NOLOGIN, hạn chế quyền cột phục vụ stock function |
| warehouse_admin_executor | Không có | NOLOGIN, hạn chế quyền catalog/user; không đọc hash, không UPDATE inventory quantity |
| users.auth_version | Không có | bigint NOT NULL DEFAULT 0, tăng trong các thay đổi quyền/trạng thái/password |
| stock_transactions.request_scan_code | Không có | varchar(80) nullable để phân biệt replay request mới và bản ghi legacy |
| record_stock_movement | Có, owner postgres, SECURITY INVOKER, proconfig=NULL, PUBLIC EXECUTE | Phiên bản đã harden/UUID replay/lock/snapshot, owner stock executor, DEFINER, fixed search_path, EXECUTE chỉ writer |
| admin_dashboard_write(bigint,text,jsonb) | Không có | Tạo function quản trị, owner admin executor, DEFINER/fixed search_path/EXECUTE hẹp |
| Credential và tài khoản đăng nhập ứng dụng | Không đọc/đổi hash main | Operator xác nhận tài khoản ứng dụng hợp lệ và provision credential writer/Redis ngoài repo |

Checksum function stock hiện tại: `59d25e310aaa5acf12ae7823f154725f`, đúng baseline cũ. ACL main hiện còn cho reader EXECUTE function qua PUBLIC và quyền TEMP; điều này không đạt policy runtime mới dù check:phase2 PASS. Không thử gọi function để chứng minh ghi được/không ghi được trên main.

Legacy audit trên main ghi nhận 10 products, 18 product_units, 10 inventory, 2 stock_transactions, 2 scan_points. Hash dữ liệu năm bảng, metadata sáu bảng và định nghĩa stock function **khớp trước/sau**; so với báo cáo baseline đã có trong Git chỉ đổi thời điểm xác minh. Không đọc/hash hàng users.

Các thay đổi còn chờ phải được chuẩn bị thành rollout dành riêng main, kiểm tra dependency/trigger/sequence/ACL và bảo toàn lịch sử. Tham khảo `scripts/phase3/40-hardening-test.psql`, `scripts/admin-dashboard/10-admin-test.psql` và [MAIN_ROLLOUT_PENDING.md](scripts/admin-dashboard/MAIN_ROLLOUT_PENDING.md) để review thiết kế; **các file test có guard và không được chạy trực tiếp trên main**. Không tự backfill/đổi password/hash hoặc reset dữ liệu main. Không có migration/GRANT nào được thực hiện trong nhiệm vụ này.

## Hướng dẫn chạy Backend cho Frontend test

1. Mở Docker Desktop; giữ nguyên credential/volume test hiện có. Kiểm tra container:

```powershell
Set-Location D:\Project_CNNT
docker compose --env-file infra/phase3/local/compose.env -f infra/phase3/compose.review.yaml up -d
docker compose --env-file infra/phase3/local/compose.env -f infra/phase3/compose.review.yaml ps
npm.cmd ci
npm.cmd test
npm.cmd run test:integration
```

2. Chọn file cấu hình riêng, không ghi đè `.env` chính:

```powershell
$env:APP_ENV_FILE = (Resolve-Path 'infra/phase3/local/backend.env').Path
npm.cmd start
```

Cấu hình test phải có PGPORT=5433, PGDATABASE=smart_warehouse_phase3_test, reader warehouse_readonly, writer warehouse_backend; ba secret dùng *_FILE trong thư mục local. ALLOWED_ORIGINS chứa đúng frontend origin, ví dụ http://127.0.0.1:5173; SESSION_SECURE=false chỉ cho HTTP demo loopback. Kiểm tra không có biến tiến trình PG/Redis cũ ghi đè file. Tài khoản demo p3_admin/keeper/staff/viewer có password riêng trong file local, không đưa vào source Frontend hoặc báo cáo.

3. Frontend dùng `WarehouseApi('/api')` và dev proxy `/api` sang http://127.0.0.1:3000, giữ Origin. Không gọi trực tiếp khác origin rồi giả định ALLOWED_ORIGINS đã bật CORS; backend hiện không có CORS middleware. Dùng hostname nhất quán localhost hoặc 127.0.0.1.

4. Login → me → đọc/ghi; client tự lấy CSRF khi cần, cookie do browser quản lý. Bigint giữ string, Table dùng pagination.total, UUID giao dịch giữ nguyên khi retry, quantity dashboard tách theo base_unit. Chi tiết tại [FRONTEND_INTEGRATION.md](docs/FRONTEND_INTEGRATION.md).

Không phát hiện lỗi còn mở ngăn Frontend dùng 29 operations trong môi trường test đã nghiệm thu. Strict TypeScript compile và kiểm thử browser/proxy được thực hiện khi dựng Frontend; các ca tải lớn và fault injection COMMIT chưa được nghiệm thu. Database chính vẫn là điều kiện chặn triển khai môi trường thật, không chặn bắt đầu phát triển Frontend trên test.
