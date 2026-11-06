# Kế hoạch migration Supabase — Smart Stationery Warehouse, Đề tài 22

Ngày rà soát: **05/11/2026**. Trạng thái: **chỉ phân tích và lập kế hoạch; chưa phê duyệt triển khai**.

> Bản kế hoạch này ghi phạm vi plan-only ban đầu. Sau đó chủ dự án cung cấp master prompt full integration và duyệt D1–D7 để sửa source/chuẩn bị SQL offline. Trạng thái hiện tại ở [checkpoint](SUPABASE_IMPLEMENTATION_STATUS.md), bộ SQL review ở [scripts/supabase](../scripts/supabase/README.md). Các giới hạn không kết nối/không thực thi DB vẫn giữ nguyên. NO-GO với Backend nguyên trạng bên dưới được xử lý bằng checker Cloud riêng có giới hạn, **chưa được chứng minh trên provider**; thêm blocker D8/password lifecycle. Không coi nội dung lịch sử “chưa tạo SQL” là trạng thái mới nhất.

## 1. Kết luận và giới hạn

Schema đích và ma trận quyền đã xác định từ source. Tuy nhiên, **NO-GO cho việc triển khai với Backend giữ nguyên ở thời điểm này**: có hai xung đột giữa chính sách startup hiện tại và hành vi Supabase được tài liệu chính thức mô tả:

1. Backend cấm quyền database `TEMP`, trong khi Supabase cấp quyền này qua `PUBLIC` và yêu cầu giữ lại cho các dịch vụ nền.
2. Backend cấm mọi membership liên quan đến hai executor, trong khi role mới trên Supabase có membership quản trị do `supabase_admin` cấp mà `postgres` không thể tự thu hồi.

Chưa kiểm tra catalog của project thực tế. Hai điểm trên là **điều kiện chặn cần xác minh**, không phải kết quả truy vấn Cloud. Không được giải quyết bằng cách bỏ kiểm tra Backend, cấp quyền rộng, hoặc thu hồi quyền dùng chung của Supabase.

Trong đợt này chỉ tạo tài liệu này. **Không tạo script triển khai; không mở kết nối PostgreSQL local/Cloud; không thực thi SQL; không chạy bootstrap/test có ghi DB; không đổi Backend, Frontend, `.env`, Docker hay volume.** Database local `smart_warehouse` nằm ngoài toàn bộ phạm vi thay đổi. Không đọc hoặc ghi credential vào tài liệu.

Thông tin Cloud do chủ dự án cung cấp, chưa xác minh độc lập: PostgreSQL **17.11**, database **`postgres`**, Data API tắt, chưa có sáu bảng/hai hàm nghiệp vụ/bốn role `warehouse_*`, schema `public` có default privileges cho các role Supabase.

Phê duyệt kế hoạch không đồng nghĩa với phê duyệt viết SQL, kết nối chỉ đọc, provision credential, thực thi migration, kiểm thử có ghi hoặc chuyển traffic. Mỗi bước cần được cho phép rõ phạm vi trước khi thực hiện.

## 2. Nguồn đã rà soát và thứ tự ưu tiên

Đã đọc toàn bộ SQL/psql trong hai thư mục yêu cầu:

| Nguồn | Ý nghĩa đối với Cloud |
| --- | --- |
| [`phase3/00-inspect-main-readonly.sql`](../scripts/phase3/00-inspect-main-readonly.sql) | Tham khảo cách kiểm tra catalog; không chạy trên main trong đợt này. |
| [`phase3/01-inspect-test-account-readonly.psql`](../scripts/phase3/01-inspect-test-account-readonly.psql) | Kiểm tra metadata tài khoản test, không dùng làm seed Cloud. |
| [`phase3/10-bootstrap-isolated-cluster.psql`](../scripts/phase3/10-bootstrap-isolated-cluster.psql) | Tạo cluster/DB test và role ban đầu; không phù hợp database Supabase đã tồn tại. |
| [`phase3/20-create-test-schema.psql`](../scripts/phase3/20-create-test-schema.psql) | Baseline sáu bảng, identity, indexes, trigger. |
| [`phase3/21-reference-function.psql`](../scripts/phase3/21-reference-function.psql) | Hàm tham chiếu cũ trước hardening; **không cài trên Cloud**. |
| [`phase3/30-test-fixtures.psql`](../scripts/phase3/30-test-fixtures.psql) | Fixture `p3_*`, dữ liệu giới hạn bigint, bản ghi legacy và cố ý thiếu inventory; **không đưa vào migration/seed Cloud**. |
| [`phase3/40-hardening-test.psql`](../scripts/phase3/40-hardening-test.psql) | Nguồn logic stock cuối cùng, `request_scan_code`, quyền tối thiểu ban đầu. |
| [`phase3/50-verify-hardening-readonly.psql`](../scripts/phase3/50-verify-hardening-readonly.psql) | Verify giai đoạn ba role, chưa phản ánh đầy đủ Admin Dashboard. |
| [`phase3/90-disable-writes-test.psql`](../scripts/phase3/90-disable-writes-test.psql) | Tham khảo containment; có guard test, không phải rollback Cloud. |
| [`phase3/assert-hardening.psql`](../scripts/phase3/assert-hardening.psql) | Assertion trung gian; số cột/quyền cũ không phải baseline cuối. |
| [`phase3/guard-test.psql`](../scripts/phase3/guard-test.psql) | Guard local test phải giữ nguyên, không nới để nhận Cloud. |
| [`admin-dashboard/10-admin-test.psql`](../scripts/admin-dashboard/10-admin-test.psql) | Nguồn cuối cho `auth_version`, admin executor, hàm Admin và ACL cột. |
| [`admin-dashboard/20-verify-admin-readonly.psql`](../scripts/admin-dashboard/20-verify-admin-readonly.psql) | Tham khảo assertion cuối cho Admin. |
| [`admin-dashboard/90-disable-admin-test.psql`](../scripts/admin-dashboard/90-disable-admin-test.psql) | Tham khảo khóa ghi Admin, không chạy trực tiếp trên Cloud. |

Đã đối chiếu thêm:

- [`BACKEND_READINESS.md`](../BACKEND_READINESS.md): hợp đồng 29 operations, trạng thái nghiệm thu local test, mô hình Auth/Redis/RBAC và điều kiện startup.
- [`PHASE3_SECURITY_REVIEW.md`](PHASE3_SECURITY_REVIEW.md): phân tích bảo mật giai đoạn 3. Các đoạn mô tả trạng thái “chưa triển khai/chưa test” thuộc thời điểm tài liệu đó; không dùng để phủ nhận kết quả readiness sau này.
- [`MAIN_ROLLOUT_PENDING.md`](../scripts/admin-dashboard/MAIN_ROLLOUT_PENDING.md) và các JS bootstrap/resume/setup trong `scripts/admin-dashboard/`: chỉ phục vụ local test, không đổi đích sang Cloud.
- [`secure-access.js`](../src/db/secure-access.js), [`secure.js`](../src/config/secure.js), [`env.js`](../src/config/env.js), repositories và [`openapi.json`](openapi.json): ràng buộc thực tế mà migration phải đáp ứng.

Baseline cuối là **schema phase3 + stock hardening + Admin Dashboard + runtime startup hiện hành**, không phải lần lượt chạy nguyên các script test. Readiness ghi nhận 29 operations thành công trên test độc lập; đó **không phải chứng cứ Supabase PASS**. Những con số test lịch sử trong readiness không được ghi thành kết quả của đợt rà soát này.

Source được rà soát tại revision local `93524bf`; trước khi chuẩn bị/chạy SQL phải chốt lại revision đầy đủ và checksum các file liên quan nếu source đã thay đổi.

## 3. Schema cuối cần tái tạo

Giữ nguyên schema **`public`** vì Backend hiện kiểm tra và truy vấn cố định schema này. Có **6 bảng, 37 cột**, **2 identity sequences**, **2 hàm nghiệp vụ**, **1 helper trigger function** và **1 trigger**. Không cần extension UUID: ứng dụng truyền UUID vào hàm.

Owner dự kiến cho sáu bảng, hai identity sequences và helper là `postgres`, dùng cho quản trị migration. Không để runtime/executor sở hữu bảng. Owner của hai hàm nghiệp vụ là hai executor tương ứng. Đây là kế hoạch ownership, còn khả năng chuyển owner trên Supabase là gate ở mục 6.

### 3.1. `public.users` — 8 cột

| Cột | Định nghĩa cuối |
| --- | --- |
| `user_id` | `bigint GENERATED ALWAYS AS IDENTITY`, PK |
| `username` | `varchar(50) NOT NULL UNIQUE` |
| `display_name` | `varchar(120) NOT NULL` |
| `role` | `varchar(20) NOT NULL`, CHECK thuộc `ADMIN`, `KEEPER`, `STAFF`, `VIEWER` |
| `password_hash` | `text`, nullable |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `auth_version` | `bigint NOT NULL DEFAULT 0` |

Không tự thêm CHECK không âm cho `auth_version`: source hiện không có. Counter tăng khi thực sự đổi role/trạng thái hoặc reset password; đổi tên/profile không tăng. Backend kiểm tra counter để vô hiệu phiên cũ. Không thay tài khoản ứng dụng bằng `auth.users` hoặc Supabase Auth.

### 3.2. `public.products` — 5 cột

| Cột | Định nghĩa cuối |
| --- | --- |
| `product_id` | `varchar(20)`, PK |
| `product_name` | `varchar(150) NOT NULL` |
| `base_unit` | `varchar(30) NOT NULL` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### 3.3. `public.product_units` — 6 cột

| Cột | Định nghĩa cuối |
| --- | --- |
| `product_unit_id` | `bigint GENERATED ALWAYS AS IDENTITY`, PK |
| `product_id` | `varchar(20) NOT NULL`, FK → `products(product_id)` |
| `unit_name` | `varchar(30) NOT NULL` |
| `conversion_factor` | `integer NOT NULL`, CHECK `>= 1` |
| `scan_code` | `varchar(80) NOT NULL UNIQUE` |
| `is_base_unit` | `boolean NOT NULL DEFAULT false` |

Các ràng buộc bổ sung:

- `uq_product_unit`: UNIQUE `(product_id, unit_name)`.
- `uq_product_unit_product`: UNIQUE `(product_unit_id, product_id)`, phục vụ FK kép của giao dịch.
- `ck_base_unit_factor`: CHECK `NOT is_base_unit OR conversion_factor = 1`.
- `uq_one_base_unit_per_product`: partial UNIQUE index `(product_id) WHERE is_base_unit`. Ràng buộc này bảo đảm **tối đa một** đơn vị cơ sở, không buộc mọi sản phẩm phải có một đơn vị cơ sở.

### 3.4. `public.inventory` — 3 cột

| Cột | Định nghĩa cuối |
| --- | --- |
| `product_id` | `varchar(20)`, PK và FK → `products(product_id)` |
| `quantity_base` | `bigint NOT NULL DEFAULT 0`, CHECK `>= 0` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

Không coi sản phẩm thiếu hàng inventory là tồn 0; hàm stock phải báo lỗi. Không tự tạo thêm hàng bằng một lần backfill che lỗi dữ liệu.

### 3.5. `public.scan_points` — 3 cột

| Cột | Định nghĩa cuối |
| --- | --- |
| `scan_point_id` | `varchar(20)`, PK |
| `point_name` | `varchar(100) NOT NULL` |
| `is_active` | `boolean NOT NULL DEFAULT true` |

### 3.6. `public.stock_transactions` — 12 cột

| Cột | Định nghĩa cuối |
| --- | --- |
| `transaction_id` | `uuid`, PK; không có DEFAULT sinh UUID |
| `product_id` | `varchar(20) NOT NULL`, FK → `products(product_id)` |
| `product_unit_id` | `bigint NOT NULL`, thuộc FK kép bên dưới |
| `scan_point_id` | `varchar(20) NOT NULL`, FK → `scan_points(scan_point_id)` |
| `user_id` | `bigint NOT NULL`, FK → `users(user_id)` |
| `movement_type` | `varchar(3) NOT NULL`, CHECK thuộc `IN`, `OUT` |
| `quantity_packages` | `integer NOT NULL`, CHECK `> 0` |
| `conversion_factor_snapshot` | `integer NOT NULL`, CHECK `> 0` |
| `quantity_base` | `bigint GENERATED ALWAYS AS (quantity_packages::bigint * conversion_factor_snapshot::bigint) STORED` |
| `inventory_after` | `bigint NOT NULL`, CHECK `>= 0` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `request_scan_code` | `varchar(80)`, nullable, không DEFAULT |

`fk_tx_unit_belongs_to_product`: FK `(product_unit_id, product_id)` → `product_units(product_unit_id, product_id)`. Tất cả FK giữ hành vi mặc định `NO ACTION`, không thêm `ON DELETE CASCADE`.

Ba indexes truy vấn:

- `idx_stock_tx_product_time (product_id, created_at DESC)`.
- `idx_stock_tx_scan_time (scan_point_id, created_at DESC)`.
- `idx_stock_tx_user_time (user_id, created_at DESC)`.

Tổng mục tiêu: **6 PK, 4 UNIQUE constraints ngoài PK, 6 FK, 8 CHECK**, 1 partial unique index và 3 indexes thời gian; tương ứng **14 indexes** gồm indexes hỗ trợ PK/UNIQUE. Verify cả định nghĩa, thứ tự cột, predicate, tính valid; không chỉ đếm.

Cloud mới tạo trực tiếp hai cột bổ sung vào schema cuối. Không giả lập upgrade bằng cách cài hàm cũ rồi vá. Nếu sau này có kế hoạch nhập lịch sử được duyệt riêng, giữ `request_scan_code = NULL` cho dữ liệu legacy không biết mã request; không suy đoán/backfill từ scan code hiện tại. Snapshot lịch sử và UUID phải giữ nguyên.

### 3.7. Identity, helper và trigger

- Hai sequences gắn identity: dự kiến `users_user_id_seq`, `product_units_product_unit_id_seq`; xác nhận bằng dependency/identity metadata, không hardcode OID.
- Không cấp `USAGE`, `SELECT`, `UPDATE` sequence cho bốn role nghiệp vụ theo baseline. Identity khác SERIAL; xác minh thao tác INSERT hợp lệ trong rehearsal thay vì tự thêm sequence grants.
- `public.create_inventory_for_product() RETURNS trigger`: PL/pgSQL, **SECURITY INVOKER**, owner `postgres`, fixed `search_path=pg_catalog, public, pg_temp`; chỉ INSERT `inventory(product_id)` từ `NEW.product_id`.
- `trg_product_inventory`: `AFTER INSERT ON public.products FOR EACH ROW` gọi helper, tạo tồn ban đầu 0. Admin executor có `INSERT(product_id)` trên inventory để trigger INVOKER hoạt động.
- Helper không phải API nghiệp vụ thứ ba; không cấp EXECUTE cho `PUBLIC`, runtime hoặc ba role Data API. Kiểm thử trigger sau khi khóa ACL helper.

## 4. Hai hàm nghiệp vụ và hợp đồng phải giữ

### 4.1. `public.record_stock_movement(uuid,bigint,character varying,character varying,character varying,integer)`

Tham số theo thứ tự: transaction UUID, actor user ID, scan point ID, scan code, movement type, quantity packages. Kết quả: `TABLE(result_status text, current_inventory bigint)`.

Đặc tính cuối: PL/pgSQL, VOLATILE, **SECURITY DEFINER**, owner **`warehouse_stock_executor`**, `proconfig` đúng duy nhất `['search_path=pg_catalog, public, pg_temp']`.

Các bất biến cần bảo toàn từ bản hardening:

1. Validate UUID v4, trường bắt buộc/độ dài/trim, `IN`/`OUT`, số kiện dương.
2. Advisory transaction lock theo hash UUID; PK UUID vẫn là hàng rào cuối, không dựa duy nhất vào hash.
3. Actor đang hoạt động: ADMIN/KEEPER nhập và xuất; STAFF chỉ xuất; VIEWER không được ghi.
4. Kiểm tra replay sau xác thực actor, trước tra catalog hiện hành: cùng UUID và đúng actor/point/code/direction/packages trả `DUPLICATE` với **`inventory_after` lịch sử**; payload khác báo conflict. Legacy `request_scan_code IS NULL` không replay.
5. Request mới kiểm tra điểm quét/sản phẩm hoạt động, đơn vị và mã quét; snapshot conversion factor tại thời điểm giao dịch.
6. Ép bigint trước phép nhân, khóa hàng inventory `FOR UPDATE`, chống xuất âm và tràn bigint; INSERT giao dịch, cập nhật inventory và snapshot kết quả trong cùng transaction. Giữ nhánh phòng vệ `ON CONFLICT` của bản hardening.

Giữ chính sách metadata concurrency hiện có: kiểm role/active/factor tại thời điểm đọc, không tự thêm khóa hoặc UPDATE users/catalog để kiểm tra stock. Request đã qua kiểm có thể hoàn thành khi metadata thay đổi đồng thời; không tuyên bố thu hồi phiên sẽ hủy transaction đang chạy.

Giữ nguyên SQLSTATE và ánh xạ HTTP:

| SQLSTATE | Hành vi | HTTP |
| --- | --- | --- |
| `PZ001` | Input sai | 400 |
| `PZ002` | Actor không hợp lệ/không hoạt động | 401 |
| `PZ003` | Không có quyền movement | 403 |
| `PZ004`, `PZ005` | Conflict UUID / legacy không replay | 409 |
| `PZ006`, `PZ007`, `PZ008` | Điểm quét / mã quét / sản phẩm không hợp lệ | 422 |
| `PZ009` | Inventory thiếu/không hợp lệ | 500 |
| `PZ010`, `PZ011` | Không đủ tồn / vượt giới hạn | 409 |

Repository hiện dùng transaction **READ COMMITTED READ WRITE**, lock timeout 1s, statement timeout 5s; tối đa hai lần retry lỗi `40001`/`40P01` trong deadline 10s, giữ UUID/payload. Không đổi nhánh COMMIT không rõ kết quả: HTTP 503 `TRANSACTION_OUTCOME_UNKNOWN` kèm UUID; không sinh UUID mới để thử lại. Stock busy tiếp tục là lỗi 503 theo hợp đồng.

### 4.2. `public.admin_dashboard_write(bigint,text,jsonb) RETURNS jsonb`

Đặc tính cuối: PL/pgSQL, VOLATILE, **SECURITY DEFINER**, owner **`warehouse_admin_executor`**, cùng `proconfig` chính xác như hàm stock.

Giữ đủ 11 actions: `product.create`, `product.update`, `product.status`, `unit.create`, `unit.update`, `scan-point.create`, `scan-point.update`, `user.create`, `user.update`, `user.status`, `user.reset-password`.

- Kiểm tra actor ADMIN đang hoạt động, allowlist/required fields, kiểu/độ dài JSON, role và encoding Argon2id; Backend tạo hash, không nhận plaintext để hash bằng SQL.
- Mọi user mutation dùng advisory transaction lock `(724901,1)` và khóa hàng cần thiết; không cho hạ quyền/vô hiệu ADMIN hoạt động cuối cùng. Giữ nguyên tăng `auth_version`.
- Unit hiện có chỉ đổi tên; gửi lại factor/base flag không đổi được chấp nhận. Không đổi factor, base flag, scan code hoặc product binding sang ý nghĩa khác. Muốn quy đổi khác phải tạo unit/code mới.
- Không đổi base unit sản phẩm đã có unit/history/tồn khác 0. Tạo product qua trigger phải tạo inventory.
- Kết quả JSON không chứa hash hoặc `auth_version`. Giữ mã `PZA01`→400, `PZA02`→404, `PZA03`→409, `PZA04`→403, `PZA05`→409, `PZA06`→409.
- Repository gọi một SELECT tham số hóa, atomic trong transaction của statement; không tự retry admin write.

### 4.3. Hợp đồng API và ranh giới tin cậy

Giữ nguyên **24 path templates / 29 operations** trong OpenAPI: Auth 4, Products/Units 7, Inventory 3, Transactions 3, Scan Points 3, Users 5, Dashboard 3, Health 1. Không thêm hard DELETE, không đổi request/response, status/error, kiểu bigint/string, pagination hoặc timestamp để phù hợp Cloud.

Frontend vẫn chỉ gọi Express. Express dùng hai pool PostgreSQL và Redis session/CSRF/RBAC hiện có. Không đưa credential DB, service key hay quyền gọi trực tiếp hai hàm vào browser. Actor ID truyền vào hàm là identity do Backend xác thực; PostgreSQL role writer là tài khoản dịch vụ tin cậy, không phải role cho người dùng cuối. Không thay cơ chế này bằng JWT `auth.uid()` hoặc Supabase Auth trong migration.

## 5. Bốn role và ma trận quyền cuối

### 5.1. Thuộc tính chung

Tất cả có: `NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. Tạo ban đầu **NOLOGIN cả bốn**, chỉ bật LOGIN cho hai runtime sau khi ACL đã được nghiệm thu và provision secret an toàn.

| Role | Trạng thái cuối | Default transaction read-only | Nhiệm vụ |
| --- | --- | --- | --- |
| `warehouse_readonly` | LOGIN | `on` | Pool đọc |
| `warehouse_backend` | LOGIN | `off` | Auth và gọi hai hàm ghi |
| `warehouse_stock_executor` | **NOLOGIN vĩnh viễn** | Không dùng làm session runtime | Owner hàm stock |
| `warehouse_admin_executor` | **NOLOGIN vĩnh viễn** | Không dùng làm session runtime | Owner hàm Admin |

Cho `USAGE public`, không `CREATE public`; runtime chỉ cần CONNECT database đích, không CREATE/TEMP. Không quyền WITH GRANT OPTION, không DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, không DML ngoài bảng/cột liệt kê. Không cấp membership vào `postgres`, role Supabase, `pg_read_all_data` hoặc executor. Runtime không sở hữu object.

Điều kiện membership phải phân biệt chính xác: startup cấm runtime **là member của role khác**; với executor cấm membership **cả hai chiều** (`member` hoặc `roleid`), kể cả ADMIN-only với INHERIT/SET tắt. Không diễn giải NOINHERIT thành “không có quyền qua PUBLIC”. Gate Supabase ở mục 6 phải được giải quyết trước.

### 5.2. Runtime reader và writer

| Role / object | Quyền đúng baseline |
| --- | --- |
| Reader / `products`, `product_units`, `inventory`, `stock_transactions`, `scan_points` | SELECT toàn bảng |
| Reader / `users` | Không SELECT bất kỳ cột nào |
| Reader / hai hàm nghiệp vụ | Không EXECUTE |
| Writer / `users` | SELECT cột `user_id, username, display_name, role, password_hash, is_active, auth_version, created_at`; dùng column grants, không whole-table grant |
| Writer / `stock_transactions` | SELECT cột `transaction_id, product_id, product_unit_id, scan_point_id, movement_type, quantity_packages, conversion_factor_snapshot, quantity_base, inventory_after, created_at` |
| Writer / hai hàm nghiệp vụ | EXECUTE, không grant option |
| Writer / bảng nghiệp vụ khác | Không SELECT; GET qua reader |
| Cả hai / toàn bộ bảng, sequences | Không direct DML, không sequence privileges |

Reader SELECT toàn bảng giao dịch bao gồm actor ID/request code ở tầng DB; các projection API tiếp tục giấu trường không được công khai. Không mô tả nhầm đây là hạn chế cột tại DB cho reader.

### 5.3. `warehouse_stock_executor`

| Object | SELECT cột | INSERT cột | UPDATE cột |
| --- | --- | --- | --- |
| `users` | `user_id, role, is_active` | — | — |
| `products` | `product_id, is_active` | — | — |
| `product_units` | `product_id, product_unit_id, scan_code, conversion_factor` | — | — |
| `scan_points` | `scan_point_id, is_active` | — | — |
| `inventory` | `product_id, quantity_base` | — | `quantity_base, updated_at` |
| `stock_transactions` | `transaction_id, user_id, scan_point_id, movement_type, quantity_packages, request_scan_code, inventory_after` | `transaction_id, product_id, product_unit_id, scan_point_id, user_id, movement_type, quantity_packages, conversion_factor_snapshot, inventory_after, request_scan_code` | `inventory_after` |

Không SELECT hash, không sửa catalog/users, không ghi generated column, không sequence grants. EXECUTE hàm stock do sở hữu hàm, không cấp thêm quyền gọi hàm Admin.

### 5.4. `warehouse_admin_executor`

| Object | SELECT cột | INSERT cột | UPDATE cột |
| --- | --- | --- | --- |
| `users` | `user_id, username, display_name, role, is_active, created_at, auth_version` | `username, display_name, role, password_hash, is_active` | `username, display_name, role, password_hash, is_active, auth_version` |
| `products` | Toàn bộ 5 cột | `product_id, product_name, base_unit, is_active` | `product_name, base_unit, is_active` |
| `product_units` | Toàn bộ 6 cột | `product_id, unit_name, conversion_factor, scan_code, is_base_unit` | `unit_name` |
| `scan_points` | Toàn bộ 3 cột | Toàn bộ 3 cột | `point_name, is_active` |
| `inventory` | `product_id, quantity_base` | `product_id` | — |
| `stock_transactions` | `product_id` | — | — |

Không SELECT `password_hash`, không UPDATE inventory, không DML giao dịch, không sequence grants. EXECUTE hàm Admin do sở hữu hàm, không cấp thêm quyền gọi hàm stock.

### 5.5. Các role Supabase và PUBLIC

Trên **object nghiệp vụ** (sáu bảng, mọi cột, hai sequences, ba functions), `PUBLIC`, `anon`, `authenticated`, `service_role` không có table/column/sequence privileges hoặc EXECUTE. Chỉ owner và writer có EXECUTE hai hàm nghiệp vụ theo ACL cuối; helper chỉ owner. Kiểm tra cả grant trực tiếp, gián tiếp, grantor, grant option và dependency mở đường qua view/function khác.

`service_role` có BYPASSRLS không đồng nghĩa được bỏ qua SQL ACL thông thường. Không grant role nghiệp vụ cho `authenticator` hoặc ba role Data API. Không thêm bảng vào Realtime publication; rà soát GraphQL, view và RPC sẵn có. Data API tiếp tục tắt, nhưng đó không thay thế ACL: Supabase mô tả tắt API sẽ chặn REST tự sinh dù grants còn tồn tại. [Supabase: Securing your API](https://supabase.com/docs/guides/api/securing-your-api), [Postgres roles trên Supabase](https://supabase.com/docs/guides/database/postgres/roles).

Không thu hồi quyền dùng chung trên managed schemas/tables/functions, không đổi owner schema `public`/database, không dùng `DROP OWNED`, `REASSIGN OWNED` hoặc `REVOKE ... ALL ... IN SCHEMA public` diện rộng trên project.

## 6. Phân tích tương thích Supabase và điều kiện chặn

### 6.1. G1 — Quyền TEMP qua PUBLIC: chặn startup

[`checkSecureAccess`](../src/db/secure-access.js) từ chối reader/writer nếu `has_database_privilege(current_database(),'CREATE,TEMP')` đúng. Chỉ một trong hai quyền là đủ để bị từ chối.

Supabase công bố `PUBLIC` có CONNECT/TEMP trên `postgres`, USAGE trên `public`, và yêu cầu giữ các grants đó cho dịch vụ nền. NOINHERIT không loại quyền qua PUBLIC. [Supabase KB: Custom role inherits privileges](https://supabase.com/kb/troubleshooting/custom-role-inherits-privileges-that-were-not-explicitly-granted-ddaa1c).

**Hệ quả từ source dự án:** REVOKE TEMP riêng trên `warehouse_*` không tạo quyền phủ định; reader/writer vẫn có TEMP nếu PUBLIC còn grant. `default_transaction_read_only=on` không thay SQL ACL. Vì vậy không thể cam kết giữ nguyên chính sách startup chỉ bằng ma trận quyền nghiệp vụ.

Xử lý ở bước sau: xin phép kiểm tra chỉ đọc ACL thực tế và xác nhận phương án được Supabase hỗ trợ với nhà cung cấp. Không đưa việc thu hồi PUBLIC TEMP/CONNECT vào migration. Nếu không có phương án đáp ứng policy hiện tại, dừng Cloud rollout; chọn PostgreSQL có đủ quyền kiểm soát ACL hoặc xin duyệt riêng một thay đổi kiến trúc/chính sách. Đợt này không chọn hoặc thực hiện thay đổi đó.

Ngoài ra cần kiểm kê effective privileges trên **mọi object `public`**: startup quét cả managed tables/sequences ở schema này, không chỉ sáu bảng kho. Grant DML/sequence từ PUBLIC trên object có sẵn cũng có thể làm startup fail. Quyền ngoài `public` và extension cần security review bổ sung, không chỉ dựa startup PASS.

### 6.2. G2 — Role membership, chuyển owner và vòng đời bảo trì

Supabase `postgres` không phải superuser. PostgreSQL 17 yêu cầu người chuyển owner có khả năng SET ROLE sang owner mới, và owner mới có CREATE trên schema hàm. Cần quyền tạm trong transaction, rồi thu hồi trước commit. [Supabase superuser restrictions](https://supabase.com/docs/guides/database/postgres/roles-superuser), [PostgreSQL 17 ALTER FUNCTION](https://www.postgresql.org/docs/17/sql-alterfunction.html).

Supabase mô tả role mới nhận ADMIN membership từ `supabase_admin`, INHERIT/SET tắt; `postgres` không thu hồi được membership này. Thu hồi membership SET tạm vẫn để lại membership quản trị. [Supabase KB: Can't revoke a role membership](https://supabase.com/kb/troubleshooting/cant-revoke-a-role-membership-granted-by-supabase_admin-d08922).

**Hệ quả từ source dự án:** hai executor sẽ fail kiểm tra `pg_auth_members` dù không ai thừa hưởng quyền của chúng. Không được coi “SET=false/INHERIT=false” là đạt chính sách “không membership”. Chỉ bỏ membership do `postgres` cấp không đủ.

G2 cần xác minh bằng catalog và xác nhận hỗ trợ từ provider. Không thử impersonate `supabase_admin`, không dùng credential nội bộ, không chấp nhận WARNING rồi coi như revoke thành công. Nếu membership bắt buộc còn tồn tại, giữ NO-GO với Backend hiện hành.

Ngay cả trên nền tảng cho phép xóa membership, phải thiết kế trước đường bảo trì: ai có thể sửa hàm sau khi owner là executor, cấp/thu hồi EXECUTE, đổi mật khẩu runtime và quản lý role? CREATEROLE không tự thay mọi quyền owner/ADMIN. Không tự xóa đường quản trị cuối cùng để đạt assertion rồi phát hiện không thể containment/upgrade. [PostgreSQL 17 role attributes](https://www.postgresql.org/docs/17/role-attributes.html), [role membership](https://www.postgresql.org/docs/17/role-membership.html).

Trong thiết kế có điều kiện: tạo hàm INVOKER → cấp khả năng owner transfer tạm → chuyển owner → kiểm tra owner/attrs → bật DEFINER → khóa EXECUTE đúng allowlist → thu hồi CREATE/SET tạm → kiểm tra **membership thực tế cuối**. Chỉ áp dụng khi G2 đã có lời giải được duyệt; chưa có script để thực hiện chuỗi này.

### 6.3. G3 — Default privileges và ACL hiện hữu

Phải đọc `pg_default_acl` theo **role thực sự tạo DDL**, object kind, phạm vi global/schema, grantor/grantee và grant option. Dự kiến tạo object bằng `postgres`; không giả định default privileges chỉ dành cho owner sau cùng.

Default privileges áp dụng theo creator khi CREATE, không kế thừa defaults từ role khác và không được làm sạch chỉ bằng ALTER OWNER. Defaults theo schema cộng vào defaults global; revoke theo schema không loại được PUBLIC EXECUTE global mặc định của function. [PostgreSQL 17 ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).

Thiết kế sau khi được duyệt:

1. Snapshot defaults/ACL trước thay đổi, xác định cả nguồn global lẫn `public` cho creator đã chọn.
2. Loại các default grants tự cấp `anon`, `authenticated`, `service_role` trên **object mới của creator** trong phạm vi đã review. Với PUBLIC EXECUTE của function phải xử lý default global của creator trong database này; ghi rõ tác động tới function creator tạo ở schema khác về sau.
3. Không sửa defaults của `supabase_admin` hoặc creator khác theo suy đoán. Nếu grantor/ownership không cho thu hồi, fail preflight để review, không bỏ qua cảnh báo.
4. Explicit revoke/allowlist trên đúng sáu bảng, cột, hai identity sequences và ba hàm sau CREATE và sau owner transfer; defaults chỉ ảnh hưởng tương lai, không sửa ACL object đã tạo.
5. Assert effective privileges bằng catalog và `has_*_privilege`, không chỉ xem text ACL. Phân biệt ACL NULL với không có quyền; cần xét default ACL của object.

Supabase hướng dẫn kiểm soát cả grants hiện hữu lẫn creator defaults; việc Data API tắt không tự loại các grants đó. [Supabase: Securing your API](https://supabase.com/docs/guides/api/securing-your-api).

### 6.4. G4 — SECURITY DEFINER, search_path, RLS và object trong public

Hai hàm cần đúng signature, owner, DEFINER và **chính xác một** setting `search_path=pg_catalog, public, pg_temp`. Không đổi sang `search_path=''`, không thêm SET statement_timeout vào function: startup hiện so sánh toàn bộ `proconfig`. Timeout migration đặt ở session/transaction.

Không role không tin cậy nào được CREATE vào schema có trong đường dẫn; `pg_temp` đặt cuối. Dùng tên schema rõ ràng trong thân hàm; revoke EXECUTE trước khi công bố hàm DEFINER, thực hiện owner/ACL trong cùng transaction để tránh cửa sổ quyền rộng. [PostgreSQL 17: Writing SECURITY DEFINER Functions Safely](https://www.postgresql.org/docs/17/sql-createfunction.html).

Giữ sáu bảng RLS **off** như baseline test hiện hành, dựa vào ACL và Backend RBAC. Không bật RLS hàng loạt mà không có thiết kế policy: runtime không sở hữu bảng và executor không BYPASSRLS, nên hành vi có thể đổi hoặc bị chặn. Nếu quy định vận hành yêu cầu RLS, cần một thiết kế và phê duyệt riêng; không coi đó là thay đổi mặc định của migration này.

Không chuyển bảng sang schema private vì Backend hiện bắt buộc `public`. Không thêm overload cho hai tên hàm; startup yêu cầu đúng hai entries/signatures. Không đặt bảng/hàm nghiệp vụ dưới owner `service_role`, `authenticator` hay `supabase_admin`.

### 6.5. G5 — Kết nối, TLS và môi trường runtime

Database tên `postgres` được config hiện tại chấp nhận; **user** `postgres` bị cấm ở runtime. Phải giữ username `warehouse_readonly`/`warehouse_backend` và cả `current_user`, `session_user` đúng như vậy.

Ưu tiên **direct connection** khi network cho phép. Supabase direct endpoint có yêu cầu IPv6 hoặc tùy chọn IPv4; username qua Supavisor có dạng `role.project-ref`. Dạng này xung đột kiểm tra literal username trong `readSecureConfig`, nên session pooler không phải thay thế trực tiếp với code hiện tại. Transaction pooling cũng không được tự chọn vì các giả định session/options/identity. Advisory **transaction** lock trong stock không tự nó là lý do cấm transaction pooler; phải xét toàn bộ runtime. [Supabase: Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres).

Code tạo pool chưa truyền object `ssl`/CA riêng; bản `pg` cài trong workspace có đọc `process.env.PGSSLMODE` khi `ssl` không được chỉ định. Vì vậy chưa kết luận TLS không thể cấu hình nếu giữ Backend. Rehearsal phải chứng minh từ **chính process Node**: bật TLS, kiểm tra CA và hostname, cả hai pool; có thể cần trusted CA qua cơ chế Node như `NODE_EXTRA_CA_CERTS` được đặt trước khởi động. Không giả định `PGSSLROOTCERT` hoặc `DATABASE_URL` đang được config ứng dụng sử dụng. Không dùng `no-verify`, `rejectUnauthorized=false` hoặc `NODE_TLS_REJECT_UNAUTHORIZED=0`. [node-postgres SSL](https://node-postgres.com/features/ssl).

Reader/writer dùng cùng host/port/database. Mặc định mỗi pool tối đa 5 connections: tính ít nhất 10/instance cộng monitoring/migration trong ngân sách Cloud. Kiểm tra connection/statement timeout và latency, không tự nới deadline hoặc retry contract.

Redis vẫn cần thiết cho session/CSRF/rate limit. Client Redis hiện chưa cấu hình TLS; cần môi trường Redis tin cậy/private phù hợp code đang có. Nếu hạ tầng yêu cầu Redis TLS mà code không hỗ trợ, đó là gate triển khai riêng cần review. Backend hiện bind loopback; nếu triển khai server từ xa, giữ runtime và dùng đường HTTPS/reverse proxy đã được thiết kế riêng, không tự sửa HOST restriction.

Không dùng `npm run dev`, bootstrap local, `setup:test-db`, hoặc integration suite local để triển khai Cloud: launcher dev cố ý cấu hình local test, xóa/đổi PG env và dùng Docker. Giữ nguyên guard local. Một process và cấu hình runtime Cloud tách biệt chỉ được provision sau phê duyệt; không sửa `.env` chính hoặc dùng credential test. Không chạy lệnh start trong đợt lập kế hoạch này.

## 7. Danh sách file SQL dự kiến và thứ tự thực hiện

**Các file dưới đây chưa được tạo.** Đây là đặc tả cho đợt chuẩn bị script sau phê duyệt; thư mục đề xuất `scripts/supabase/`. Không đưa SQL thực thi hoặc credential mẫu vào tài liệu này.

| File dự kiến | Trách nhiệm và điều kiện |
| --- | --- |
| `00-preflight-readonly.sql` | Transaction READ ONLY/ROLLBACK; kiểm tra target, version, roles/memberships/grantors, ACL/defaults, extension/public objects, G1–G5. Không gọi business function hay đọc hash/dữ liệu user. |
| `10-create-restricted-roles.sql` | Tạo đúng bốn role NOLOGIN, attrs/settings tối thiểu; chỉ khi giải được G1/G2. Không CREATE DATABASE, không cấp LOGIN/password. |
| `20-secure-creator-defaults.sql` | Sửa defaults của đúng creator/phạm vi đã duyệt, xử lý global function PUBLIC EXECUTE và schema grants; không quét sửa toàn bộ managed defaults. |
| `30-create-business-schema.sql` | Tạo trực tiếp schema cuối 6 bảng/37 cột, constraints/indexes, identity/helper/trigger; không fixture, không hàm stock baseline. Không đòi toàn bộ public trống. |
| `40-create-stock-function.sql` | Bản logic hardening được review, ban đầu INVOKER, fixed search_path, khóa EXECUTE ban đầu. |
| `41-create-admin-function.sql` | Bản Admin cuối, ban đầu INVOKER, fixed search_path, khóa EXECUTE ban đầu. |
| `42-grant-minimal-object-privileges.sql` | Explicit ACL cho đúng object/cột theo mục 5, loại grants Data API/PUBLIC, không grant sequence dư. |
| `43-transfer-owners-and-lockdown.sql` | Owner transfer/DEFINER/EXECUTE allowlist, dọn quyền CREATE/SET tạm, assert memberships và khả năng containment đã được rehearsal. Phụ thuộc lời giải G2. |
| `49-assert-final-catalog.sql` | Assertion đầy đủ trước COMMIT; chỉ đọc metadata, không tự BEGIN/COMMIT, không thử ghi bằng vai trò owner. |
| `50-apply-atomic.psql` | **Entrypoint duy nhất cho DDL**, ON_ERROR_STOP, guard target và timeouts; một transaction bao gồm `10` → `20` → `30` → `40` → `41` → `42` → `43` → `49`. Fail là rollback. |
| `60-provision-runtime-and-first-admin.sql` | Bước operator riêng có phê duyệt: secret truyền qua runner riêng ngoài repo, bootstrap ADMIN đầu tiên và credentials runtime; không hardcode, không echo/ghi log hash/password. Bật LOGIN chỉ sau kiểm tra quyền. |
| `70-verify-readonly.sql` | Sau commit, catalog/effective ACL bằng connections mới và identity thật của reader/writer; READ ONLY/ROLLBACK, không gọi hàm ghi. |
| `80-verify-access-staging.sql` | Negative ACL và nghiệp vụ **có thể ghi**, chỉ staging Cloud dùng một lần với dữ liệu tổng hợp và phê duyệt riêng; rollback từng scenario khi có thể. Không gắn nhãn read-only. |
| `90-contain-writes.sql` | Containment được diễn tập: chặn traffic mới, quyền ghi chính xác, tài khoản runtime theo quyền operator có thật; không xóa schema/dữ liệu hoặc hạ bảo mật. |
| `99-verify-containment-readonly.sql` | Xác nhận không còn đường ghi mới và ACL hardening còn nguyên; phân biệt connection đang mở và transaction đang chạy. |

Không chạy từng subfile `10`–`49` thủ công. Không copy `BEGIN/COMMIT`, `\ir guard-test.psql`, checksum hàm cũ hoặc lệnh revoke diện rộng từ script test sang entrypoint Cloud. Không dùng IF NOT EXISTS để lờ schema/role drift; gặp object trùng hoặc baseline khác phải dừng và review.

Thứ tự vận hành đề xuất sau các phê duyệt riêng:

1. Cho phép viết và review các script theo kế hoạch; chốt source revision/checksum và allowlist object.
2. Cho phép kết nối **chỉ đọc** project đích: chạy `00`, thu inventory không nhạy cảm, giải quyết G1–G5. Nếu FAIL thì không chạy DDL. Không tạo role thử nghiệm trên project thật để “xem có được không”.
3. Xác nhận backup/restore và operator có quyền containment; diễn tập đầy đủ trên project staging riêng tương đương PG17.11/Supabase, gồm grantor/membership và restart Backend. Staging cũng cần được phép tạo/ghi riêng.
4. Review kết quả staging, phê duyệt migration đích cụ thể; snapshot metadata trước, giữ backend/traffic chưa kết nối, chạy entrypoint `50` một lần.
5. Chạy `70` kiểm tra metadata; provision `60` qua kênh secret riêng, xác minh lại runtime LOGIN/identity/ACL bằng connection mới. Hai role executor luôn NOLOGIN.
6. Nghiệm thu đủ 29 APIs trên staging qua typed client và runtime thật, lưu bằng chứng đã lọc secrets. Mọi smoke test có ghi trên project đích nếu cần phải được cho phép riêng và định nghĩa dữ liệu/cleanup.
7. Phê duyệt cutover riêng, cấu hình process Cloud tách biệt; không trỏ launcher/test/main hiện tại sang Cloud. Theo dõi lỗi/retry/connection/permission và chuẩn bị containment.

### Guard target và tính atomic

Database tên `postgres` hoặc version 17.11 **không đủ** định danh project. Runner tương lai cần allowlist hostname/project identity được operator xác nhận qua kênh riêng, TLS verification và catalog baseline độc lập; không chứa credential trong allowlist. Từ chối loopback/local main, DB test, unknown endpoint và mọi target mismatch. Không xem PUBLIC trống là điều kiện Supabase vì có thể chứa managed objects hợp lệ.

Migration chỉ tạo object mới đã liệt kê và sửa defaults đã duyệt; không tạo DB, không đụng `auth`, `storage`, `realtime`, `extensions` hoặc managed role. Metadata manifest/checksums được lưu ở artifact kiểm soát truy cập, không thêm bảng nghiệp vụ thứ bảy. Thay đổi schema/roles/grants/defaults thuộc transaction DDL; không lẫn provision secret hoặc thao tác ngoài transaction vào lời hứa atomic.

## 8. Provision credential và dữ liệu ban đầu

Không có dữ liệu sản phẩm, inventory hoặc users nào được sao chép từ local trong kế hoạch này. Import dữ liệu thật cần một kế hoạch riêng về mapping ID, nhất quán snapshots, NULL legacy, identity sequences và bảo vệ dữ liệu; không tự mở kết nối local để trích xuất.

Cloud trống cần ADMIN đầu tiên vì hàm Admin yêu cầu actor ADMIN có sẵn. Operator quản trị sẽ bootstrap tối thiểu một ADMIN với hash Argon2id phù hợp verifier hiện tại, bằng bước provision riêng; không bỏ kiểm tra actor, không tạo tài khoản/mật khẩu mặc định trong SQL. Định danh/secret người nhận do chủ dự án cung cấp qua kênh an toàn ở bước đó.

Credential DB reader, DB writer, Redis và tài khoản ứng dụng là các credential riêng biệt. Lưu bằng secret manager hoặc secret files được kiểm soát, truyền qua cơ chế runtime hiện có; không đặt vào source, `.env.example`, terminal history, connection URL, README, issue, log CI hoặc output nghiệm thu. Script provision tương lai phải tránh echo bind values và kiểm soát cả server-side query logging. Không giả định client parameterization tự bảo vệ log server.

Đối với role password, dùng công cụ/runner quản trị phù hợp cú pháp utility PostgreSQL và secret channel đã review; không ghép chuỗi SQL tùy tiện. Rotation, quyền bảo trì role và thu hồi session phải được diễn tập cùng G2 trước khi bật LOGIN.

## 9. Kế hoạch xác minh

Tất cả kiểm tra dưới đây là **dự kiến**, chưa chạy trong đợt này. Không dùng kết quả local cũ để đánh dấu Cloud đạt.

### 9.1. Kiểm tra metadata và quyền hiệu lực

- So sánh toàn bộ 37 cột, typmod, NOT NULL/default, generated/identity definitions, 6 PK/4 UNIQUE/6 FK/8 CHECK, 14 indexes, sequence dependencies, trigger và helper. Kiểm tra RLS trạng thái theo baseline.
- Hai hàm đúng signature/result/language/volatility/owner/DEFINER/proconfig, không overload; checksum thân hàm theo source đã review, không dùng checksum hàm reference cũ làm baseline Cloud.
- Bốn role đúng attrs; runtime LOGIN đúng giai đoạn; kiểm tra membership hai chiều kèm `grantor`, `admin_option`, `inherit_option`, `set_option`, quyền SET ROLE thực tế.
- Catalog trước/sau cho database/schema ACL, creator defaults, object ACL và cột; tính quyền hiệu lực qua PUBLIC/membership/ownership, không chỉ đọc `relacl/proacl`.
- Xác nhận `anon`, `authenticated`, `service_role` không có quyền bảng/cột/sequence/hàm nghiệp vụ trực tiếp hoặc qua đường gián tiếp; PUBLIC không EXECUTE helper/hai hàm. Không cấp lại grants rộng để dập cảnh báo console.
- Kiểm kê tất cả object public ảnh hưởng `checkSecureAccess` và các object/schema khác mà runtime có thể truy cập; managed objects/defaults ngoài allowlist không đổi.
- Connection mới reader/writer có `current_user = session_user` đúng tên, read-only mặc định `on`/`off`, database/host đúng, TLS có xác minh certificate/hostname, không dùng postgres runtime.
- Chạy chính preflight Backend trên staging với cấu hình Cloud riêng. PASS cần cả metadata assertion và startup thực tế, không chỉ tạo đủ bảng.

### 9.2. Negative access tests trên staging

READ ONLY/ROLLBACK phù hợp kiểm tra catalog, không chứng minh đủ ACL ghi. Trên staging được phép, tách thử nghiệm:

- Reader ở session read-only bị chặn ghi `25006`; khi cố ý mở READ WRITE vẫn bị ACL `42501`. Không coi lỗi read-only là bằng chứng không có INSERT grant.
- Reader không đọc users/không EXECUTE hàm nghiệp vụ; writer không direct INSERT/UPDATE inventory, transactions hoặc users và không SET ROLE executor.
- Stock executor không đọc password hash/sửa catalog; admin executor không đọc hash/UPDATE inventory/DML giao dịch. Kiểm tra role trong harness quản trị staging phù hợp, không để membership thử nghiệm tồn tại ở baseline cuối.
- Ba role Data API không SELECT/INSERT/UPDATE/DELETE, không sequence access và không gọi hai hàm qua quyền hiệu lực. Giữ Data API tắt trước/sau; kiểm tra endpoint riêng chỉ khi đã được phép.
- Thao tác hợp lệ tạo product/user/unit qua hàm chạy được với trigger/identity dù không sequence grants. Nếu không đúng kỳ vọng thì dừng review, không grant ALL.

Test có cấp membership tạm hoặc thử DML không phải “read-only”. Rollback dữ liệu không hoàn tác mọi sequence advancement; không reset sequence để xóa dấu vết test. Dùng staging riêng và ghi rõ tác dụng phụ.

### 9.3. Nghiệm thu nghiệp vụ và 29 APIs

Thiết kế harness Cloud staging riêng; giữ nguyên host/port/marker guards của suite local, không sửa chúng để qua Cloud. Dùng fixture tổng hợp được duyệt riêng, không chạy `30-test-fixtures.psql` nguyên bản trên đích.

| Nhóm | Điều kiện đạt |
| --- | --- |
| Contract | 29 operations qua typed client → Express → PostgreSQL/Redis thật; kiểm tra schema/status/projection/bigint; 26 operations yêu cầu session trả 401 khi thiếu phiên. |
| Auth/CSRF/RBAC | Bốn application roles đúng quyền; chặn actor giả, CSRF/Origin sai; status/role/password reset tăng counter và làm phiên cũ mất hiệu lực; Users chỉ ADMIN. |
| Admin | Create/update/status thực, tạo inventory qua trigger, unit bất biến đúng quy định, last active ADMIN không bị loại kể cả hai connection cạnh tranh. |
| Stock | IN/OUT với factor đúng, snapshot và generated quantity đúng, không âm/tràn bigint; inactive actor/point/product và inventory thiếu báo lỗi đúng hợp đồng. |
| Idempotency | Cùng UUID/payload chỉ một transaction/delta; replay trả lịch sử; khác actor/point/code/direction/packages conflict; legacy NULL bị từ chối; replay sau biến động catalog vẫn đúng. |
| Concurrency | Hai connection có `pg_backend_pid()` khác nhau xuất cạnh tranh không oversell; duplicate đồng thời và admin lock có kết quả xác định. |
| Failure | Lock timeout/deadlock/retry giữ UUID; mất kết quả COMMIT giữ `TRANSACTION_OUTCOME_UNKNOWN`; fault injection chỉ staging được duyệt, không báo PASS nếu chưa thực hiện. |
| Vận hành | Startup restart qua credentials mới, giới hạn pool/latency/TLS, Redis/session/rate-limit, containment và đường bảo trì G2 được chứng minh. |

## 10. Rủi ro và quyết định dừng

| Rủi ro | Mức | Điều kiện xử lý |
| --- | --- | --- |
| PUBLIC TEMP làm startup fail; revoke gây ảnh hưởng nền tảng | **Chặn** | G1 có kết quả kiểm tra và phương án provider hỗ trợ, không hạ policy Backend. |
| ADMIN membership bắt buộc của executor làm startup fail | **Chặn** | G2 có giải pháp đúng policy được xác minh; nếu không thì không triển khai. |
| Không có quyền bảo trì owner/containment sau lockdown | **Chặn** | Diễn tập owner transfer, upgrade, rotation, disable và khôi phục quyền có kiểm soát. |
| Default privileges/ACL cấp dư cho Data API/PUBLIC | Cao | G3, scoped revoke, assert quyền hiệu lực và audit grantor; cảnh báo không phải thành công. |
| Public objects/extensions có quyền ngoài nghiệp vụ | Cao | Inventory toàn bộ quyền runtime; không phá managed objects để ép PASS. |
| Pooler username/session hoặc TLS/IPv6 không phù hợp | Cao | G5 bằng runtime thật; không đổi identity check/disable TLS verification. |
| Seed/credential bị lộ hoặc dùng nhầm DB chính | Cao | Target guard nhiều yếu tố, provision riêng, secrets ngoài repo/log, không dùng launcher local. |
| RLS/search_path/overload làm đổi hành vi | Cao | Giữ baseline, exact assertions; không tự chuyển schema/thêm policy. |
| Rollback làm mất lịch sử hoặc lặp giao dịch | Cao | Ưu tiên containment, bảo toàn UUID/snapshots/counter; đối soát trước retry/restore. |
| Cloud latency/connection budget khác local | Trung bình | Đo staging, giữ transaction/timeout contract, chưa đủ bằng chứng thì chưa cutover. |

Không đánh dấu GO chỉ vì SQL COMMIT thành công. Nếu G1/G2 không giải được trên Supabase tiêu chuẩn, kết luận cần giữ là **không tương thích với chính sách Backend hiện tại**; phương án nền tảng hoặc thay đổi policy phải là quyết định mới của chủ dự án.

## 11. Rollback và containment an toàn

### 11.1. Trước COMMIT

Entry point DDL dùng một transaction và fail ngay khi assertion sai; rollback cả schema/role/ACL/defaults trong transaction. Không bắt lỗi để tiếp tục, không tự COMMIT từng file. Secret provisioning nằm ngoài transaction này và chưa bật runtime trong giai đoạn DDL.

Nếu mất connection lúc COMMIT, coi kết quả chưa xác định. Sau khi được phép, mở connection mới đọc catalog/manifest/checksums để xác định đã commit hay rollback; không chạy lại nguyên migration hoặc cố xóa object trùng.

### 11.2. Sau COMMIT, trước business traffic

Giữ ứng dụng chưa trỏ vào Cloud. Nếu verify fail, không provision/bật runtime hoặc phát credential. Ưu tiên giữ schema đã harden để điều tra.

Nếu cần khóa ghi: dừng request mới ở ứng dụng, drain transaction đang chạy, sau đó dùng đường quản trị đã diễn tập để thu hồi EXECUTE **đúng hai signatures** hoặc khóa writer LOGIN. `postgres` đã chuyển owner chưa chắc có thể REVOKE EXECUTE sau khi bỏ memberships; không giả định quyền đó tồn tại. Đường dự phòng có thể là thu hồi quyền bảng/cột do `postgres` sở hữu khỏi executor để fail closed, nhưng phải được chứng minh trước và bảo toàn metadata để khôi phục có kiểm soát.

NOLOGIN chỉ chặn login mới; không đóng session hiện có. REVOKE không hủy transaction đã chạy. Terminate/cancel connection chỉ khi operator có quyền, xác định đúng PID/ứng dụng và được phép, sau khi đánh giá COMMIT chưa rõ kết quả. Tắt Data API không chặn đường ghi Express.

Không chuẩn bị destructive down migration tự động. Xóa object mới chỉ có thể xét khi chứng minh không có dữ liệu/dependency/traffic và có phê duyệt riêng; không `DROP SCHEMA public CASCADE`, không `DROP OWNED`, không drop role diện rộng.

### 11.3. Sau khi đã có giao dịch

Ưu tiên **containment rồi sửa tiến**, giữ dữ liệu và audit trail. Không xóa `request_scan_code`, `auth_version`, transactions hoặc snapshot; không cài lại hàm reference, mở PUBLIC EXECUTE hoặc trả quyền DML trực tiếp cho writer.

Ghi nhận UUID request đang chờ/không rõ kết quả, đối soát transaction và tồn kho trước retry. Không tạo UUID mới thay request cũ chỉ vì chuyển môi trường. Không đồng bộ ngược vào `smart_warehouse` hoặc chạy song song hai writer vào hai DB khi chưa có kế hoạch cutover dữ liệu riêng.

Backup/PITR, retention, restore granularity và quyền thực hiện phụ thuộc gói/project thực tế, hiện chưa xác minh. Trước rollout phải có backup bảo vệ truy cập, bản metadata DDL/owners/ACL/defaults/memberships và một lần restore rehearsal ở project tách biệt. Không đặt dump dữ liệu/hash/secrets trong git; không giả định backup tự phục hồi custom role passwords/membership grantor đúng yêu cầu.

Restore toàn project có thể ảnh hưởng Auth/Storage/dịch vụ khác và mất giao dịch sau restore point; cần đánh giá/phê duyệt riêng, không tự rollback toàn project chỉ để sửa sáu bảng kho. Khi khôi phục defaults/ACL phải đối chiếu baseline chính xác, không khôi phục grant rộng hoặc sửa managed ACL ngoài allowlist. Đường provider/break-glass cần được xác nhận từ trước, không xin quyền ngầm trong lúc sự cố.

## 12. Checklist nghiệm thu và các phê duyệt còn thiếu

### Đợt lập kế hoạch này

- [x] Rà soát toàn bộ SQL ở hai thư mục, readiness và phase3 security review.
- [x] Xác định schema cuối, hàm, role và ACL từ source; đối chiếu startup/config/API.
- [x] Phân tích Supabase bằng tài liệu PostgreSQL 17/Supabase/node-postgres chính thức.
- [x] Lập danh sách script **dự kiến**, thứ tự, gates, verification và rollback.
- [x] Không kết nối DB, không chạy SQL/migration/test ghi, không tạo script triển khai, không sửa ứng dụng hoặc credential.

### Trước khi được viết/chạy migration

- [ ] Chủ dự án phê duyệt kế hoạch và phạm vi chuẩn bị SQL riêng.
- [ ] Cho phép kiểm tra Cloud chỉ đọc với target/project và operator rõ ràng.
- [ ] G1: quyền CREATE/TEMP hiệu lực đáp ứng startup, không phá quyền dịch vụ Supabase.
- [ ] G2: membership/owner/maintainability đáp ứng đúng startup; provider xác nhận đường vận hành hợp lệ.
- [ ] G3: snapshot defaults/ACL/grantor và phạm vi thay đổi creator được review.
- [ ] G4: schema/search_path/DEFINER/ACL/RLS đúng baseline, public không có đường tạo object không tin cậy.
- [ ] G5: direct connection/identity/TLS/network/Redis/proxy phù hợp Backend giữ nguyên.
- [ ] Có staging riêng được phép tạo/ghi, review SQL và source checksums; guard local vẫn nguyên.
- [ ] Có backup/restore rehearsal và containment/rotation/upgrade được chứng minh.
- [ ] Chủ dự án phê duyệt chạy migration trên project cụ thể; phê duyệt provision/seed và kiểm thử ghi theo phạm vi riêng.

### Trước cutover

- [ ] Schema/constraints/indexes/trigger/identity/hàm đúng toàn bộ, không chỉ đủ số lượng.
- [ ] Bốn role và quyền hiệu lực đúng allowlist; không quyền nghiệp vụ cho PUBLIC/ba role Data API.
- [ ] Backend startup qua hai LOGIN thật PASS, hai executor NOLOGIN; không thay policy để qua preflight.
- [ ] 29 APIs và concurrency/security/failure scenarios có bằng chứng staging, ghi rõ phần chưa test.
- [ ] Credentials ngoài repo/log, ADMIN ban đầu hợp lệ, session invalidation đúng.
- [ ] Data API vẫn tắt; managed objects/defaults ngoài phạm vi không đổi.
- [ ] Không thay đổi local `smart_warehouse`, launcher/test guards, Backend, Frontend hoặc Docker volume.
- [ ] Có phê duyệt cutover riêng và người chịu trách nhiệm containment/đối soát.

**Trạng thái hiện tại: chờ phê duyệt kế hoạch; chưa có quyền viết script triển khai hoặc thực hiện bất kỳ thay đổi Database nào.**
