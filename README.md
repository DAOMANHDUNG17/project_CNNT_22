# SmartWarehouse — Quản lý kho văn phòng phẩm

Ứng dụng quản lý kho gồm **React + TypeScript + Ant Design**, backend **Node.js / Express**, **PostgreSQL** và **Redis Session**. Các trang quản lý sử dụng REST API thật; module Nhập / Xuất kho hiện hiển thị **Đợi An phát triển** theo phân công nhóm.

**Profile Supabase Cloud đang được tích hợp, chưa được phép triển khai.** `npm run dev:cloud` đã có nhưng đang bị chặn trước khi kết nối do các quyết định bảo mật chưa được nghiệm thu. Xem [trạng thái và checkpoint](docs/SUPABASE_IMPLEMENTATION_STATUS.md), [hướng dẫn Cloud](docs/SUPABASE_RUNBOOK.md). Hướng dẫn bên dưới vẫn dành cho **local-test**; không trỏ các lệnh setup/test này vào Supabase.

## 1. Chuẩn bị trước khi chạy

Hướng dẫn dưới đây dùng **Windows + PowerShell**, thực hiện tại thư mục chứa repository sau khi clone. Thư mục dự án có thể nằm ở bất kỳ ổ đĩa nào, không bắt buộc là D:\Project_CNNT.

| Công cụ | Yêu cầu |
| --- | --- |
| Git | Đã cài và có quyền clone repository |
| Node.js và npm | Node **24.7 trở lên**; npm đi kèm Node |
| Docker Desktop | Đang mở, dùng **Linux containers**, có Docker Compose |
| PostgreSQL 17 command-line tools | Có file **C:\Program Files\PostgreSQL\17\bin\psql.exe** để chạy bước khởi tạo database lần đầu |

PostgreSQL và Redis của ứng dụng chạy trong Docker. Trên Windows chỉ cần công cụ **psql 17** cho script bootstrap; không cần khởi động thêm PostgreSQL server trên máy. Script bootstrap hiện dùng cố định đường dẫn psql ở trên. Nếu dùng macOS/Linux hoặc cài psql ở vị trí khác, trao đổi với Dũng để điều chỉnh đường dẫn trước khi khởi tạo.

Kiểm tra nhanh trong PowerShell:

```powershell
git --version
node --version
npm.cmd --version
docker compose version
Test-Path 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
```

Lệnh cuối cần trả về **True**. Các cổng **3000, 5173, 5433, 6379** cần sẵn sàng cho dự án. Mở Docker Desktop và đợi Docker Engine sẵn sàng trước khi làm bước tiếp theo.

## 2. Chạy lần đầu sau khi git clone

**Chỉ thực hiện bộ lệnh này khi máy chưa có cấu hình/database test của dự án.** Mỗi máy tự tạo cấu hình, mật khẩu và database test riêng.

```powershell
# Clone và vào đúng thư mục gốc của dự án
git clone https://github.com/DAOMANHDUNG17/project_CNNT_22.git
cd project_CNNT_22

# Cài dependencies cho cả backend và frontend
npm.cmd ci
# Root postinstall tự chạy npm ci trong frontend.

# Tạo cấu hình và mật khẩu local một lần
npm.cmd run setup:test-infra

# Khởi động PostgreSQL test và Redis, đợi container healthy
docker compose --env-file infra/phase3/local/compose.env -f infra/phase3/compose.review.yaml up -d --wait --wait-timeout 120

# Khởi tạo schema, quyền và tài khoản mẫu trên database test mới
npm.cmd run setup:test-db

# Chạy cả backend và frontend
npm.cmd run dev
```

**Chạy từng bước; nếu một lệnh báo lỗi, xử lý lỗi đó trước khi chạy lệnh tiếp theo.** Lần đầu Docker cần tải image nên có thể mất thêm thời gian.

Hai lệnh setup có nhiệm vụ khác nhau:

- **setup:test-infra** tạo file cấu hình, Redis ACL và mật khẩu ngẫu nhiên tại **infra/phase3/local/**. Thư mục này được Git bỏ qua, vì vậy clone mới chưa có các file này.
- **setup:test-db** tạo database test và dữ liệu mẫu, cấp credential cho các role runtime và tài khoản đăng nhập web. Chỉ chạy khi container đã healthy và database test chưa tồn tại.

Không sao chép mật khẩu hoặc file cấu hình từ máy thành viên khác. Không commit **.env**, secret hay **infra/phase3/local/**. Các bước trên dùng **127.0.0.1:5433 / smart_warehouse_phase3_test**, không dùng database chính ở cổng 5432.

## 3. Mở ứng dụng và đăng nhập

| Nội dung | Địa chỉ |
| --- | --- |
| Giao diện / đăng nhập | http://127.0.0.1:5173/login |
| Backend | http://127.0.0.1:3000 |
| Kiểm tra kết nối database | http://127.0.0.1:3000/api/health |
| Swagger / OpenAPI | http://127.0.0.1:5173/swagger/ |
| Trang module của An | http://127.0.0.1:5173/stock-movement |

Sau khi setup database thành công, dùng các tài khoản test sau. **Mỗi máy có mật khẩu riêng, không có mật khẩu mặc định chung.**

| Tài khoản web | Vai trò | File mật khẩu trên máy của bạn |
| --- | --- | --- |
| p3_admin | Quản trị viên | infra/phase3/local/p3_admin-password.txt |
| p3_keeper | Thủ kho | infra/phase3/local/p3_keeper-password.txt |
| p3_staff | Nhân viên | infra/phase3/local/p3_staff-password.txt |
| p3_viewer | Người xem | infra/phase3/local/p3_viewer-password.txt |

Ví dụ, xem mật khẩu **đăng nhập web** của quản trị viên trong terminal riêng của bạn:

```powershell
Get-Content -Raw infra/phase3/local/p3_admin-password.txt
```

Nhập tên tài khoản **p3_admin** và mật khẩu vừa đọc vào trang đăng nhập. Không đưa nội dung mật khẩu vào Git, ảnh chụp hoặc tin nhắn công khai. Tài khoản inactive/no-hash có trong fixture để kiểm thử và không dùng đăng nhập demo.

Giữ địa chỉ **127.0.0.1** nhất quán khi mở ứng dụng để cookie và proxy cùng hostname. Swagger hiện là tài liệu **chỉ tra cứu**, tắt Try it out; hướng dẫn thử API với session/CSRF nằm trong [bàn giao cho An](docs/AN_FRONTEND_HANDOFF.md).

## 4. Những lần chạy tiếp theo

Sau khi đã setup thành công, mỗi lần làm việc chỉ cần mở Docker Desktop, vào thư mục dự án và chạy:

```powershell
cd project_CNNT_22
npm.cmd run dev
```

Nếu terminal đã ở thư mục gốc repository thì chỉ chạy **npm.cmd run dev**. Không chạy lại hai lệnh setup mỗi lần mở dự án.

Lệnh dev tự bật container test, đợi healthy, chọn cấu hình backend test rồi mở backend và frontend trong cùng terminal. Trong Command Prompt hoặc terminal hỗ trợ npm bình thường, có thể dùng **npm run dev** tương đương.

- **Ctrl+C**: dừng hai server frontend/backend; container vẫn chạy để dùng lại.
- Docker giữ dữ liệu PostgreSQL trong volume. Redis demo không persistence; khi Redis khởi động lại, cần đăng nhập lại.
- Nếu muốn dừng container sau buổi làm việc, dùng lệnh dưới đây; dữ liệu PostgreSQL vẫn được giữ:

```powershell
docker compose --env-file infra/phase3/local/compose.env -f infra/phase3/compose.review.yaml stop
```

### Khi lấy code mới từ đồng đội

Dừng dev server, sau đó chạy tại thư mục gốc:

```powershell
git pull
npm.cmd ci
npm.cmd --prefix frontend ci
npm.cmd run dev
```

Giữ nguyên cấu hình/volume local đang có. Nếu bản cập nhật yêu cầu thay đổi database, làm theo hướng dẫn riêng của người phụ trách backend; npm run dev không tự chạy migration hoặc reset dữ liệu.

## 5. Lỗi thường gặp

| Hiện tượng | Cách xử lý |
| --- | --- |
| PowerShell chặn npm.ps1 | Dùng **npm.cmd** như hướng dẫn; không cần đổi Execution Policy |
| Docker không kết nối được / Docker Engine chưa chạy | Mở Docker Desktop, đợi Engine sẵn sàng; kiểm tra đang dùng Linux containers |
| Missing local test configuration | Máy mới cần chạy **setup:test-infra**, Compose rồi **setup:test-db** theo mục 2 |
| Test configuration already exists | Cấu hình đã có; giữ nguyên các file local, tiếp tục đúng bước còn thiếu thay vì tạo lại |
| Test DB already exists | Không chạy lại bootstrap; thử **npm.cmd run dev**. Nếu trước đó bootstrap bị lỗi giữa chừng, nhờ Dũng kiểm tra trạng thái database |
| setup:test-db lỗi ở bước gọi psql / status FAIL | Kiểm tra đúng psql 17 tại đường dẫn ở mục 1, rồi xem bước SQL nào báo lỗi. Không tự xóa volume để thử lại |
| Port 3000/5173 is unavailable | Dừng phiên dev cũ của chính dự án hoặc ứng dụng đang dùng cổng đó trước khi chạy lại |
| Docker báo trùng cổng 5433/6379 | Kiểm tra PostgreSQL/Redis hoặc stack Docker khác đang dùng cổng; trao đổi với nhóm trước khi đổi cấu hình |
| Backend preflight thất bại / chưa healthy | Kiểm tra container bằng lệnh bên dưới và xác nhận bước setup:test-db đã hoàn tất |
| Đăng nhập không đúng mật khẩu | Dùng đúng tài khoản và file mật khẩu local trên máy hiện tại, không dùng mật khẩu máy khác |
| Quá nhiều lần đăng nhập / HTTP 429 | Đợi theo thông báo Retry-After; không gửi đăng nhập liên tục |

Kiểm tra container:

```powershell
docker compose --env-file infra/phase3/local/compose.env -f infra/phase3/compose.review.yaml ps
```

## 6. Lệnh kiểm tra dành cho nhóm

Chạy tại thư mục gốc repository:

```powershell
# Không cần database: backend unit/regression và frontend unit
npm.cmd test
npm.cmd --prefix frontend test

# TypeScript và production build frontend
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend run build

# Cần PostgreSQL/Redis test đã setup; tạo dữ liệu kiểm thử trên test
npm.cmd run test:integration

# Dừng dev server trước; E2E tự mở hai server riêng, dùng Microsoft Edge đã cài
npm.cmd --prefix frontend run test:e2e
```

Chạy một suite integration/E2E tại một thời điểm. Hai kịch bản E2E phụ thuộc form Nhập/Xuất được đánh dấu chờ An; không tính là chức năng đã hoàn thiện.

## 7. Tài liệu và phân công

| Thành viên | Phụ trách |
| --- | --- |
| Dũng | Backend, PostgreSQL, Redis, API và tích hợp |
| An | Frontend quét mã, nhập/xuất kho |
| Nam | Hạ tầng mạng |
| Vy | Kiểm thử |

- [Hướng dẫn frontend](frontend/README.md)
- [Bàn giao module nhập/xuất cho An](docs/AN_FRONTEND_HANDOFF.md)
- [Hợp đồng OpenAPI](docs/openapi.json) và [typed API client](docs/api-client.ts)
- [Hướng dẫn tích hợp frontend/backend](docs/FRONTEND_INTEGRATION.md)
- [Backend readiness](BACKEND_READINESS.md) và [Frontend readiness](FRONTEND_READINESS.md)

**Phạm vi hiện tại:** backend mới được nghiệm thu trên môi trường test độc lập. Database chính còn chờ rollout schema/quyền riêng; không chạy bootstrap, migration hoặc CRUD test trên main.

---

<details>
<summary><strong>Tài liệu kỹ thuật backend và cấu hình chi tiết</strong></summary>

## Kiến trúc

```text
React / Ant Design → same-origin /api proxy → Express
                                            ├─ Auth / CSRF / RBAC → Redis sessions + rate limit
                                            ├─ Reader → warehouse_readonly → SELECT kho
                                            └─ Writer → warehouse_backend
                                                ├─ SELECT hẹp: Auth / Users / kết quả giao dịch
                                                ├─ record_stock_movement → warehouse_stock_executor
                                                └─ admin_dashboard_write → warehouse_admin_executor
```

Hai executor là NOLOGIN, không phải tài khoản kết nối ứng dụng. Hai function dùng SECURITY DEFINER, owner riêng, search_path cố định, EXECUTE giới hạn. Reader/writer không có DML trực tiếp. Hai pool mặc định tối đa 5 connection **mỗi pool**, connect/statement timeout 5 giây; reader đặt default_transaction_read_only=on, writer=off. HTTP chỉ bind loopback.

`src/server.js` là entry point có xác thực; chỉ listen sau preflight identity/ACL PostgreSQL và kết nối/PING Redis. `src/read-app.js` chỉ phục vụ regression legacy. Health chạy SELECT 1 trên reader, không chứng minh Redis/schema/ACL đầy đủ.

## Cài đặt và cấu hình

```powershell
Set-Location D:\Project_CNNT
node --version
npm.cmd ci
```

Dùng `npm.cmd` khi PowerShell chặn `npm.ps1`, không cần đổi Execution Policy. Không commit `.env`, secret hoặc `infra/phase3/local/`.

### Chạy backend và frontend bằng một lệnh

Với môi trường test đã được thiết lập, mở Docker Desktop rồi chạy tại thư mục gốc:

```powershell
npm.cmd run dev
```

Lệnh này bật PostgreSQL test và Redis bằng Docker Compose, đợi container healthy, chạy backend có tự reload, rồi chạy frontend Vite sau khi backend trả health thành công. Mở **http://127.0.0.1:5173**; backend ở **http://127.0.0.1:3000**. Nhấn `Ctrl+C` để dừng cả hai server; container test vẫn chạy để dùng lần sau.

`dev` luôn dùng `infra/phase3/local/backend.env`, bỏ các biến cấu hình backend cũ được kế thừa từ terminal. Không chạy migration, seed hoặc bootstrap. Nếu chưa có dependencies frontend, chạy `npm.cmd --prefix frontend ci` một lần. Nếu chưa có môi trường test, làm theo mục **Môi trường test độc lập** bên dưới.

Chạy riêng từng phần bằng `npm.cmd run dev:frontend` hoặc `npm.cmd run dev:backend`. Backend riêng cần chọn `APP_ENV_FILE` như bên dưới. `npm.cmd start` vẫn chỉ chạy backend theo cấu hình được chọn.

Backend đọc `APP_ENV_FILE`, mặc định `.env` của project; biến môi trường tiến trình ưu tiên hơn file. Giữ `.env` hiện có cho kiểm tra chỉ đọc database chính. Chạy Backend test bằng file riêng:

```powershell
$env:APP_ENV_FILE = (Resolve-Path 'infra/phase3/local/backend.env').Path
npm.cmd start
# Hoặc npm.cmd run dev:backend
```

Không để biến PG/Redis cũ trong tiến trình ghi đè cấu hình test. `.env.example` là mẫu đầy đủ hướng tới cluster test, cần điền credential riêng hoặc dùng secret file; không sao chép đè `.env` đang dùng.

| Biến | Ý nghĩa |
| --- | --- |
| NODE_ENV, HOST, PORT | development/production; loopback; mặc định 3000 |
| APP_ENV_FILE | Chọn file riêng, nên dùng đường dẫn tuyệt đối |
| PGHOST, PGPORT, PGDATABASE, PGSCHEMA | Reader/writer chung đích; runtime hỗ trợ public |
| PGUSER, PGPASSWORD hoặc PGPASSWORD_FILE | Reader bắt buộc warehouse_readonly |
| WRITE_PGUSER, WRITE_PGPASSWORD hoặc WRITE_PGPASSWORD_FILE | Writer bắt buộc warehouse_backend |
| PGPOOL_MAX, PGCONNECT_TIMEOUT_MS, PGQUERY_TIMEOUT_MS | Áp dụng cho cả hai pool |
| REDIS_HOST, REDIS_PORT, REDIS_USERNAME | Test dùng ACL user warehouse_session |
| REDIS_PASSWORD hoặc REDIS_PASSWORD_FILE | Secret session, khác health credential |
| ALLOWED_ORIGINS | Origin frontend chính xác, phân cách dấu phẩy, không path/dấu / cuối |
| SESSION_SECURE | true cho HTTPS; production ép true và chỉ nhận HTTPS origins |

`*_FILE` ưu tiên hơn secret trực tiếp. File chứa đúng secret, không BOM/newline/NUL; đường dẫn tương đối tính từ working directory. Không log password/hash/connection string.

Cookie tên cố định `warehouse_session` khi HTTP, `__Host-warehouse_session` khi Secure; HttpOnly, SameSite=Lax, Path=/, không Domain. Idle 30 phút, absolute 8 giờ. Runtime không hỗ trợ biến env cho cookie name/SameSite/TTL.

## Môi trường test độc lập

PostgreSQL test: **127.0.0.1:5433 / smart_warehouse_phase3_test**. Database chính ở cổng 5432. Compose giữ image digest cố định cho PostgreSQL test và Redis. Với môi trường test đã tồn tại, mở Docker Desktop rồi chạy:

```powershell
docker compose --env-file infra/phase3/local/compose.env -f infra/phase3/compose.review.yaml up -d
docker compose --env-file infra/phase3/local/compose.env -f infra/phase3/compose.review.yaml ps
```

Không chạy lại bootstrap để reset database test. Chỉ với máy mới chưa có cấu hình/database test:

```powershell
npm.cmd run setup:test-infra
# Khởi động hai container bằng Compose phía trên, đợi healthy.
npm.cmd run setup:test-db
```

Setup sinh secret ngẫu nhiên, từ chối ghi đè. Bootstrap cần `C:\Program Files\PostgreSQL\17\bin\psql.exe`, database mới và marker `phase3.environment=isolated-test-v1`, từ chối cluster chứa database chính. SQL test có guard từ chối main; không được gọi tự động từ start/test.

Fixture gồm `p3_admin`, `p3_keeper`, `p3_staff`, `p3_viewer`, tài khoản inactive/no-hash. Password ngẫu nhiên ở file `p3_*-password.txt` trong thư mục local; không có password mặc định trong tài liệu. PostgreSQL postgres chỉ phục vụ bootstrap/kiểm chứng **test**, không dùng làm runtime role.

Redis demo không persistence; restart làm mất phiên. Health ACL chỉ PING; session ACL chỉ các lệnh và namespace session/rate cần thiết. Backend dùng session credential.

## Kiểm thử

```powershell
npm.cmd test                       # 78 unit/regression, không cần DB
npm.cmd run test:legacy-unit       # 31 kiểm tra factory đọc cũ
npm.cmd run test:backend-unit      # 47 Auth/Admin/Dashboard/config/contract
npm.cmd run test:integration       # Backend mới, PostgreSQL test + Redis thật
npm.cmd run test:all               # unit + integration Backend mới
```

`test:secure-integration` là alias của `test:integration`. Integration mới đọc trực tiếp local/backend.env, kiểm tra đích test/marker, không phụ thuộc `.env` chính. Test tạo dữ liệu tổng hợp trên test, không reset/drop database. Trước mỗi fixture, chỉ xóa đúng rate-counter của tài khoản fixture và IP loopback trên Redis test để chạy lặp lại; không FLUSHDB/xóa phiên hàng loạt. Chạy một suite integration tại một thời điểm.

Bộ mới kiểm tra 29 operation qua `docs/api-client.ts`, status/body theo OpenAPI, toàn bộ 26 operation cần phiên, CRUD theo contract, Auth/CSRF/RBAC, Redis TTL/rate/ACL/mất kết nối, UUID replay, chống xuất vượt tồn bằng hai PostgreSQL connection khác PID, và khởi động `server.js` qua APP_ENV_FILE.

Các lệnh chỉ đọc database chính được tách riêng; dùng terminal với `.env` chính:

```powershell
Remove-Item Env:APP_ENV_FILE -ErrorAction SilentlyContinue
npm.cmd run check:db
npm.cmd run check:phase2
npm.cmd run test:legacy-integration
npm.cmd run check:main
```

Legacy integration đối chiếu bảy API đọc bằng factory cũ; hash/count năm bảng, metadata sáu bảng và function trước/sau. Không đọc dữ liệu users hoặc ghi dù để rollback. Không dùng kết quả này để kết luận Auth/Admin mới chạy trên main. Chữ ký và hash trước/sau vẫn được kiểm tra, không ép checksum của function trước hardening cho mọi phiên bản.

`check:main` dùng BEGIN READ ONLY và catalog, không gọi business function/DDL/GRANT. Exit 1/result=FAIL nghĩa là main chưa đủ điều kiện Backend mới, không tự cấp quyền. Bằng chứng: [main inspection](docs/backend-main-inspection.json), [29 API](docs/backend-api-verification.json), [legacy audit](docs/phase2-verification.json).

## Hợp đồng API và Frontend

Frontend đã có thiết kế **Premium Red Enterprise** với font Be Vietnam Pro local. Chạy `npm.cmd run dev` ở thư mục gốc để mở cả backend test và frontend; xem [frontend README](frontend/README.md) và [frontend readiness](FRONTEND_READINESS.md).

Module `/stock-movement` hiện hiển thị **Đợi An phát triển** theo phân công. An xem [tài liệu bàn giao](docs/AN_FRONTEND_HANDOFF.md) và Swagger tại **http://127.0.0.1:5173/swagger/**. Swagger đọc đặc tả hiện có, ở chế độ tra cứu; thử API ghi bằng typed client trên môi trường test với session/CSRF hiện tại.

[OpenAPI](docs/openapi.json), [TypeScript client](docs/api-client.ts), [React/Ant Design](docs/FRONTEND_INTEGRATION.md), [Dashboard](docs/ADMIN_READ_API.md) là tài liệu hiện tại. Tài liệu phase 2/3 còn lại lưu lịch sử thiết kế/rollout.

| Nhóm | Operations |
| --- | --- |
| Auth | POST login/logout, GET me/csrf: 4 |
| Products và Units | GET list/detail, POST product/unit, PATCH product/status/unit: 7 |
| Inventory | GET list/detail/low-stock: 3 |
| Transactions | GET list/detail, POST nhập/xuất: 3 |
| Scan Points | GET list, POST, PATCH: 3 |
| Users | GET list, POST, PATCH profile/status, POST reset-password: 5 |
| Dashboard | GET summary/stock-trends/top-products: 3 |
| System | GET health: 1 |

| Quyền | ADMIN | KEEPER | STAFF | VIEWER |
| --- | --- | --- | --- | --- |
| Đọc kho/dashboard | Có | Có | Có | Có |
| Nhập kho | Có | Có | Không | Không |
| Xuất kho | Có | Có | Có | Không |
| Đọc/quản trị users, ghi catalog | Có | Không | Không | Không |

CRUD theo contract dùng status để vô hiệu product/user, is_active cho scan point; không có hard DELETE/DELETE unit. Unit cũ không đổi scan_code/product/factor/is_base_unit; dùng unit và mã quét mới. Base unit chỉ đổi trước khi có unit/history/tồn khác 0. Last active ADMIN không thể bị hạ quyền/vô hiệu hóa. Thay role/status/password tăng auth_version để thu hồi phiên.

Frontend dùng `WarehouseApi('/api')` và development proxy cùng origin tới `http://127.0.0.1:3000`. Backend không có CORS cho fetch trực tiếp từ origin khác; ALLOWED_ORIGINS kiểm tra Origin/CSRF. Giữ hostname localhost/127.0.0.1 nhất quán và giữ nguyên Origin qua proxy.

Client tự lấy CSRF trước lần ghi đầu tiên, dùng credentials include, giữ token trong memory. Không lưu session/password vào browser storage. List có data/count/pagination; Ant Design Table dùng pagination.total, không dùng count. Bigint/aggregate quantity/count là string, timestamp ISO UTC. Dashboard date range dùng ngày UTC tối đa 366 ngày bao gồm hai đầu; quantity ranking phải chọn baseUnit.

UUID v4 sinh một lần mỗi nghiệp vụ kho. Retry giữ nguyên UUID và payload: CREATED=201, DUPLICATE=200, khác payload=409. inventory_after là snapshot lịch sử. 503 TRANSACTION_OUTCOME_UNKNOWN có error.transaction_id: giữ pending và retry đúng yêu cầu; không tạo UUID mới. Client không tự retry write. 401 về login, 403 phân biệt quyền/Origin/CSRF, 429 tôn trọng Retry-After.

## Database chính còn chờ triển khai

Main hiện chỉ đủ baseline đọc. Ba role mới, auth_version, request_scan_code, stock function đã harden, admin function và ACL còn chờ triển khai thủ công. Không sửa password/hash/dữ liệu hiện hữu hoặc bỏ guard script test để chạy main tùy tiện. Xem [rollout pending](scripts/admin-dashboard/MAIN_ROLLOUT_PENDING.md) cùng báo cáo nghiệm thu.

Trước khi bật Frontend với main cần triển khai schema/quyền đã review, cung cấp credential writer/Redis riêng và tài khoản ứng dụng đăng nhập hợp lệ, rồi kiểm tra môi trường đích. Không chạy CRUD integration này trên database chính.

</details>
