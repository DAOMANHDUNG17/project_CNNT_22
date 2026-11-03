# Kế hoạch giai đoạn 3 — Xác thực, phân quyền và nhập/xuất kho

Trạng thái: **kiến trúc đã được phê duyệt có điều kiện; chỉ đang chuẩn bị môi trường và script để review, chưa triển khai**. Ngày phân tích: 03/11/2026, múi giờ Asia/Bangkok. Phạm vi dự án: `D:\Project_CNNT`.

Chủ dự án đã chốt reader/writer riêng, owner NOLOGIN tối thiểu, RBAC STAFF chỉ OUT, bảo vệ sáu GET, Redis session 30 phút/8 giờ và idempotency B. Quyền đọc cột auth chỉ dành cho warehouse_backend; không tự reset mật khẩu. Điều kiện tiếp theo: xem [báo cáo chuẩn bị](PHASE3_PREPARATION.md), [đánh giá bảo mật và SQL diff](PHASE3_SECURITY_REVIEW.md), phê duyệt riêng môi trường test/quyền/script trước khi triển khai Auth/RBAC/Session/API ghi. Không áp DDL/GRANT/ALTER FUNCTION lên smart_warehouse chính ở bước này. Các chữ “đề xuất/chờ duyệt” trong nội dung thiết kế ban đầu bên dưới được hiểu theo trạng thái cập nhật này.

Tài liệu này được tạo sau khi đọc source, README, REST_API.md, SCHEMA_PHASE2.md, kế hoạch/báo cáo giai đoạn 2, scripts kiểm quyền và các kiểm thử hiện có; đồng thời kiểm tra PostgreSQL thật bằng `warehouse_readonly` trong transaction `READ ONLY`. Không thay code, cấu hình, quyền, mật khẩu, schema hoặc dữ liệu; không gọi `record_stock_movement()`. Các thiết kế, quyền và câu SQL minh họa dưới đây chưa được áp dụng.

## 1. Kết luận và phương án đề nghị

1. Giữ sáu bảng, dữ liệu lịch sử, URL và cấu trúc thành công của bảy GET API. Bổ sung xác thực cho sáu API dữ liệu; health giữ công khai trên loopback. Việc GET dữ liệu bắt đầu yêu cầu phiên là thay đổi hành vi cần duyệt.
2. Giữ nguyên tài khoản/pool `warehouse_readonly`; bổ sung tài khoản/pool `warehouse_backend` riêng cho đăng nhập và gọi nghiệp vụ. Không cấp DML trực tiếp cho hai tài khoản runtime.
3. Dùng phiên opaque lưu phía server trong Redis, cookie HttpOnly và chống CSRF; backend tra lại trạng thái/role hiện tại từ DB. Không dùng role hoặc user_id do client khai báo để quyết định quyền.
4. Gia cố hàm hiện có: owner NOLOGIN riêng, SECURITY DEFINER, search_path cố định, tên bảng có schema, EXECUTE theo allowlist, SQLSTATE nghiệp vụ ổn định, kiểm quyền theo hướng IN/OUT và bảo toàn transaction nguyên tử.
5. Đề xuất ADMIN/KEEPER được IN và OUT; STAFF chỉ OUT; VIEWER chỉ đọc. Hàm hiện tại cho STAFF cả IN và OUT, vì vậy đây là quyết định nghiệp vụ mới, chưa phải quyền đã được xác nhận.
6. Dùng UUID `transaction_id` hiện có làm khóa idempotency. Không thêm bảng chống trùng. Có thể giữ nguyên toàn bộ cột nếu chấp nhận các điều kiện retry ở mục 6; nếu cần replay bền vững theo mã quét gốc, đề nghị thêm một cột nullable vào stock_transactions, vẫn giữ đúng sáu bảng.
7. Chỉ kiểm thử ghi/concurrency trên database thử nghiệm riêng sau phê duyệt. Kế hoạch hiện tại không chạy các kiểm thử này trên DB đang có dữ liệu.

## 2. Bằng chứng hiện trạng

### 2.1. Backend và dữ liệu

| Nội dung | Kết quả kiểm tra |
| --- | --- |
| Stack | Node.js >=24, Express 5, pg; PostgreSQL thực tế 17.11 |
| DB / schema / runtime role | smart_warehouse / public / warehouse_readonly |
| Identity và quyền giai đoạn 2 | Preflight `checkPhase2Access()` PASS bằng kết nối thật |
| Chế độ đọc | Client options và setting role trong database đều đặt default_transaction_read_only=on; transaction phân tích READ ONLY |
| Sáu bảng | products, product_units, inventory, stock_transactions, scan_points, users; owner postgres; RLS chưa bật |
| Quyền bảng hiệu lực | SELECT năm bảng nghiệp vụ; users không SELECT, kể cả từng cột; không INSERT/UPDATE/DELETE/TRUNCATE trên sáu bảng |
| Role runtime | LOGIN, NOINHERIT, không superuser/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS; không membership |
| Schema/database | CONNECT và USAGE public: có; CREATE database/schema: không; TEMP database: có |
| Dữ liệu được phép đọc | 10 products, 18 product_units, 10 inventory, 2 stock_transactions, 2 scan_points |
| Baseline kiểm thử | 36/36 unit/regression, 10/10 integration theo kết quả giai đoạn 2; không chạy lại và không coi đây là test giai đoạn 3 |

Fingerprint dữ liệu năm bảng, metadata sáu bảng và định nghĩa hàm trong lần đọc này khớp `docs/phase2-verification.json`. Fingerprint metadata: `1d2a0f1013064251fe5e9f8fea159b24ebb912e0d424bc0fe20f701cdf462e1b`. MD5 định nghĩa hàm: `59d25e310aaa5acf12ae7823f154725f` — đây là checksum mã hàm, không phải password hash. Hai snapshot trong cùng transaction đọc cũng khớp; cùng snapshot không chứng minh các session khác không ghi đồng thời.

Source đang có:

- `src/app.js`: ghép router, no-store, chưa có body JSON parser/auth/session/CSRF.
- `src/repositories/read.js`: SELECT tham số hóa, projection rõ ràng; count và page trong một statement; không JOIN users.
- `src/routes/transactions.js`: chỉ GET; chưa có POST.
- `src/config/env.js`: chặn tài khoản postgres, bind loopback, mặc định kết nối chỉ đọc.
- `src/middleware/error-handler.js`: lỗi an toàn 400/404/500/503; chưa có mapping lỗi nghiệp vụ ghi, 401/403/409/422/429.
- `scripts/lib/phase2-access.js`: cố định kỳ vọng warehouse_readonly/read-only. Không sửa kỳ vọng này để tài khoản ghi vượt qua kiểm tra cũ.
- Có trigger products → tạo inventory sau INSERT; không có trigger tùy chỉnh trên users/inventory/stock_transactions. Giai đoạn 3 không cung cấp API tạo sản phẩm.

### 2.2. Bảng users, role và khả năng đăng nhập thử nghiệm

| Cột | Cấu trúc thực tế |
| --- | --- |
| user_id | bigint, PK, GENERATED ALWAYS AS IDENTITY |
| username | varchar(50), NOT NULL, UNIQUE |
| display_name | varchar(120), NOT NULL |
| role | varchar(20), NOT NULL, CHECK chỉ ADMIN/KEEPER/STAFF/VIEWER |
| password_hash | text, **nullable**, không default, chưa có CHECK thuật toán/định dạng |
| is_active | boolean, NOT NULL, default true |
| created_at | timestamptz, NOT NULL, default now() |

UNIQUE username hiện theo ngữ nghĩa collation/index PostgreSQL đang có; chưa có normalization hoặc unique index lowercase. Giai đoạn 3 giữ username phân biệt hoa/thường, không tự đổi dữ liệu hoặc tự chuyển sang đăng nhập không phân biệt hoa/thường.

**Giới hạn đã xác minh:** quyền hiện tại không cho đọc bất kỳ cột users nào. Do đó chưa xác minh số tài khoản, tài khoản thử nghiệm có tồn tại/active hay không, hash NULL/rỗng/placeholder/hợp lệ hay thuật toán hiện dùng. Không thử SELECT dữ liệu users, không tìm mật khẩu quản trị, không đoán username/password và không đăng nhập thử. Tài khoản PostgreSQL warehouse_readonly kết nối được không chứng minh một tài khoản ứng dụng trong users đăng nhập được.

DBA có thể cung cấp kết quả kiểm tra an toàn sau đây bằng session đã có quyền đọc users. Đây là truy vấn minh họa **chưa chạy**, không cần cấp thêm quyền cho warehouse_readonly. Thay chuỗi placeholder bằng tên tài khoản thử nghiệm đã được chủ dự án chỉ định; chạy trong transaction READ ONLY:

```sql
SELECT
  count(*) = 1 AS account_exists,
  coalesce(bool_or(is_active), false) AS account_active,
  coalesce(bool_or(password_hash IS NOT NULL
                    AND length(btrim(password_hash)) > 0), false) AS hash_present,
  coalesce(bool_or(password_hash LIKE '$argon2id$%'), false) AS argon2id_marker,
  coalesce(bool_or(password_hash ~ '^\$2[aby]\$'), false) AS bcrypt_marker
FROM public.users
WHERE username = 'TEN_TAI_KHOAN_THU_NGHIEM';
```

Chỉ trả boolean; không trả mật khẩu/hash/độ dài hash hoặc dump user. Marker thuật toán chỉ là kiểm tra sơ bộ, không chứng minh hash parse được, thông số an toàn hoặc mật khẩu đúng. Bước xác minh sau phê duyệt phải dùng thư viện verifier trên backend, với mật khẩu do người dùng nhập qua luồng bảo mật; không ghi request đăng nhập vào log. Nếu NULL/rỗng/placeholder/không hỗ trợ thì từ chối đăng nhập, không tự đặt mật khẩu mặc định hoặc cho qua bằng username.

## 3. Phân tích record_stock_movement() hiện có

### 3.1. Chữ ký và kết quả

`public.record_stock_movement(uuid, bigint, varchar, varchar, varchar, integer)`

| Tham số | Ý nghĩa và nguồn đúng trong giai đoạn 3 |
| --- | --- |
| p_transaction_id | UUID của một thao tác nghiệp vụ, client giữ nguyên khi retry |
| p_user_id | bigint của người dùng đã xác thực, do backend lấy từ phiên; không lấy từ body/header tùy ý |
| p_scan_point_id | Mã điểm quét, tối đa 20 ký tự theo bảng; hàm kiểm tồn tại và active |
| p_scan_code | Mã product_units, tối đa 80 ký tự theo bảng; hàm tra sản phẩm/đơn vị/factor |
| p_movement_type | IN hoặc OUT |
| p_quantity_packages | integer dương, số gói; không phải số đơn vị cơ sở |

Kiểu trả: `TABLE(result_status text, current_inventory bigint)`; nhánh thành công trả một hàng. CREATED trả tồn sau cập nhật; DUPLICATE trả **inventory_after đã lưu của giao dịch cũ**, có thể khác tồn hiện tại. API nên gọi tên giá trị này là inventory_after. Hàm không trả transaction đầy đủ; backend phải SELECT bản ghi đã lưu nếu response cần snapshot/time/product.

### 3.2. Luồng thực tế

1. Tra users theo p_user_id, bắt buộc active. Cho phép ADMIN, KEEPER, STAFF; VIEWER bị từ chối. Không phân biệt quyền IN và OUT.
2. Kiểm điểm quét active, hướng IN/OUT, số gói dương.
3. Tra scan_code qua product_units JOIN products active; lấy product_id, product_unit_id, conversion_factor.
4. Tính quantity_base bằng bigint × bigint; đặt delta dương cho IN, âm cho OUT.
5. Khóa đúng hàng inventory của sản phẩm bằng SELECT FOR UPDATE; thiếu hàng thì lỗi, không tự tạo tồn 0.
6. Tra UUID trong stock_transactions. Nếu trùng product_id, product_unit_id, user_id, scan_point_id, movement_type và quantity_packages thì trả DUPLICATE; khác thì lỗi tái sử dụng UUID.
7. INSERT lịch sử với factor snapshot, tạm ghi inventory_after bằng tồn trước; ON CONFLICT(transaction_id) DO NOTHING. Nếu không INSERT được thì đọc lại giao dịch và kiểm cùng payload lần nữa, bảo vệ trường hợp cùng UUID nhắm hai sản phẩm khác nhau.
8. UPDATE inventory bằng quantity_base + delta, điều kiện kết quả >=0; không cập nhật được thì ném lỗi thiếu tồn.
9. UPDATE inventory_after của giao dịch vừa tạo, rồi trả CREATED.

Hàm không COMMIT độc lập. Lỗi không bị bắt/nuốt sẽ rollback thay đổi của statement; backend phải rollback toàn bộ transaction lỗi. Nếu thiếu tồn sau INSERT, không được tồn tại giao dịch tạm sau rollback. Không được trả HTTP thành công trước COMMIT.

### 3.3. Concurrency và giới hạn

- Hai UUID khác nhau cùng sản phẩm, kể cả từ hai scan point: khóa cùng hàng inventory, lần sau đợi và xử lý trên tồn đã commit; tránh lost update và xuất âm. Khóa theo sản phẩm, không theo điểm quét.
- Cùng UUID/cùng payload: khóa hàng tồn rồi đọc giao dịch cũ; chỉ có một lần biến đổi tồn nếu mọi caller dùng luồng này.
- Cùng UUID/khác sản phẩm: khóa hai hàng tồn khác nhau, PK UUID và ON CONFLICT là hàng rào cuối. Nhánh đọc lại cần snapshot mới ở READ COMMITTED; không mặc định suy luận giống nhau dưới REPEATABLE READ/SERIALIZABLE.
- PostgreSQL READ COMMITTED có thể bỏ INSERT do xung đột chưa thấy trong snapshot của chính INSERT. Đọc lại ở statement tiếp theo và retry transaction khi cần phải được kiểm thử thật. [PostgreSQL 17 — isolation](https://www.postgresql.org/docs/17/transaction-iso.html).
- Mỗi giao dịch hiện chỉ có một sản phẩm nên không cần khóa nhiều hàng tồn; nếu sau này thêm chứng từ nhiều dòng phải khóa sản phẩm theo thứ tự nhất quán và retry deadlock.
- Checks users/product/scan point/factor là SELECT thông thường, diễn ra trước lúc có thể chờ khóa tồn; không khóa chống DBA sửa role/active/factor đồng thời. Quyền được đánh giá tại thời điểm kiểm tra, không bảo đảm hủy một nghiệp vụ đang chạy khi role vừa bị thu hồi. Không có API sửa metadata trong phạm vi giai đoạn này; thay đổi quản trị đồng thời phải có quy trình riêng.
- quantity_packages và factor là int32 dương nên tích tối đa vẫn trong bigint; cộng vào tồn bigint đang lớn vẫn có thể overflow. Phải trả lỗi stock limit an toàn và rollback, không ép xuống Number.
- p_transaction_id NULL chưa được báo lỗi nghiệp vụ sớm, cuối cùng bị constraint NOT NULL từ chối. Một số tham số khác dựa vào lookup hoặc constraint thay cho validation rõ ràng.
- Các RAISE EXCEPTION nghiệp vụ hiện không đặt SQLSTATE riêng, phần lớn cùng P0001. Không dùng mọi P0001 = thiếu tồn hoặc parse message tùy ý để quyết định status HTTP.
- Hàm không xác thực danh tính p_user_id; bất kỳ caller có đủ quyền DB đều có thể gửi ID người khác. Backend là ranh giới tin cậy về danh tính người dùng ứng dụng.

### 3.4. Security và ACL thực tế

| Thuộc tính | Hiện tại | Hệ quả |
| --- | --- | --- |
| Mode | SECURITY INVOKER, prosecdef=false | Chạy theo quyền người gọi |
| Owner | postgres, superuser | Hiện chưa nâng quyền caller; chuyển DEFINER nguyên trạng sẽ có mức ảnh hưởng rất lớn |
| Volatility | VOLATILE | Phù hợp hàm có ghi; không đánh dấu STABLE/IMMUTABLE |
| search_path function | proconfig=NULL | Chưa có path riêng; session là `"$user", public` |
| Tham chiếu bảng/type | users, inventory, stock_transactions và `%ROWTYPE` chưa schema-qualified | Có nguy cơ phân giải sai đối tượng; đặc biệt nguy hiểm sau khi nâng quyền |
| ACL | proacl=NULL | Dùng quyền mặc định, không có nghĩa là cấm gọi |
| EXECUTE hiệu lực | PUBLIC và owner có EXECUTE; warehouse_readonly=true | Read-only role hiện vẫn được phép gọi về ACL, nhưng thiếu SELECT users/DML và ở chế độ chỉ đọc |

Không gọi hàm để thử khả năng ghi. Trong cấu hình hiện tại, EXECUTE không thay thế quyền bảng và không chứng minh ghi được. Tuy nhiên, nếu đổi sang DEFINER mà giữ EXECUTE PUBLIC, warehouse_readonly cũng có thể tiếp cận đường ghi sau khi caller mở transaction read-write. default_transaction_read_only không phải ACL chống ghi bất biến.

public hiện không cho PUBLIC/warehouse_readonly CREATE, nhưng database vẫn cho TEMP; không được dựa vào việc public không writable để bỏ qua bảo vệ temporary schema. Quy tắc INVOKER/DEFINER, search_path và EXECUTE mặc định được đối chiếu với [PostgreSQL 17 — CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html).

## 4. Kiến trúc xác thực và phiên đề xuất

### 4.1. Luồng request

Trình duyệt → cookie phiên + CSRF header cho request thay đổi trạng thái → xác minh phiên Redis → tra user hiện tại từ DB → RBAC middleware → validation allowlist → service nghiệp vụ → một pg client/transaction → hàm nghiệp vụ → SELECT giao dịch đã lưu → COMMIT → response an toàn.

Backend tạo principal nội bộ gồm user_id, role, is_active. Cookie chỉ mang token ngẫu nhiên; client không tự xác lập principal. Mọi user_id/role trong body POST giao dịch bị từ chối như trường ngoài hợp đồng, kể cả khi trùng với người đang đăng nhập. Không tin X-User-Id/X-Role; không đọc danh tính từ query.

### 4.2. Đăng nhập và mật khẩu

- POST login chỉ nhận username/password. Tra username chính xác bằng query tham số, chỉ projection cần xác thực. Password hash chỉ ở bộ nhớ của luồng auth, không vào generic repository, response, trace hoặc log.
- Verifier hỗ trợ thuật toán được kiểm tra/duyệt sau khi có kết quả kiểm hash. Đề xuất Argon2id cho mật khẩu được tạo mới qua quy trình riêng; mức khởi điểm m=19456 KiB, t=2, p=1 và benchmark trên máy triển khai. Hash cũ được hỗ trợ rõ ràng nếu đủ an toàn; không tự đổi hash, rehash hay mật khẩu ở bước phân tích hoặc ở lần triển khai đầu nếu chưa được duyệt. [OWASP — Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- Không tồn tại/inactive/hash thiếu/hash sai đều trả lỗi đăng nhập chung. Dùng dummy verification phù hợp để giảm khác biệt timing; giới hạn input và concurrency để tránh DoS khi verify hash.
- Rate limit dùng Redis theo IP và định danh username đã chuẩn hóa cho mục đích limiter; đề xuất 5 lần lỗi/15 phút cho một cặp tài khoản-IP, thêm giới hạn IP/tài khoản tổng để chống phân tán. Không khóa vĩnh viễn hoặc làm lộ tài khoản tồn tại. Thông số cần điều chỉnh theo các máy quét dùng chung IP. [OWASP — Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
- Không có public register, reset password, đổi role hoặc CRUD users trong phạm vi giai đoạn 3 này.

### 4.3. Phiên và token

- Khuyến nghị opaque session, không cần JWT access/refresh cho trình duyệt cùng origin hiện tại. Sinh token CSPRNG 256 bit; lưu digest token cùng user_id, issued_at, last_seen, absolute_expires_at trong Redis, không lưu password/hash.
- Idle timeout đề nghị 30 phút; absolute timeout 8 giờ. Refresh idle không kéo dài absolute timeout. Rotate token sau login; logout thu hồi session phía server và xóa cookie.
- Mỗi request đã xác thực tra lại role/is_active từ PostgreSQL; không chỉ tin role đã chụp lúc login. User inactive hoặc đã bị xóa: hủy phiên/401; role không đủ: 403. Thay role ảnh hưởng request kế tiếp; không cam kết hủy request đã qua authorization.
- Cookie HTTPS: `__Host-warehouse_session`, Secure, HttpOnly, SameSite=Lax, Path=/, không Domain. Không để session token trong localStorage hoặc response JSON. Localhost HTTP phát triển dùng cookie tên riêng và Secure=false chỉ khi cấu hình development/loopback rõ ràng; production fail closed nếu cấu hình cookie/TLS không phù hợp.
- CSRF synchronizer token gắn với phiên; frontend lấy token qua endpoint phiên/CSRF và gửi X-CSRF-Token khi POST/logout. Kiểm Origin theo allowlist, Content-Type JSON, áp dụng bảo vệ login bằng kiểm Origin và cơ chế CSRF trước đăng nhập nếu cần. Không xem SameSite là biện pháp CSRF duy nhất. [OWASP — Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP — CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
- Giữ cùng origin/dev proxy và bind loopback; chưa mở CORS rộng hoặc mạng LAN. Nếu dùng reverse proxy HTTPS, cấu hình trust proxy đúng số hop/nguồn tin cậy.
- Redis dùng ACL riêng, không public, TLS nếu qua mạng; tất cả instance dùng cùng store/limiter. Redis lỗi thì 503, không fallback phiên trong RAM. In-memory store chỉ phù hợp test, không là phương án production.
- Thay/reset password sau này phải có thao tác thu hồi toàn bộ phiên của user trong cùng quy trình vận hành. Chưa có auth_version/password_changed_at để tự phát hiện DBA đổi hash ngoài luồng; không tuyên bố đã giải quyết trường hợp này.

Redis giữ số bảng PostgreSQL bằng sáu nhưng thêm một dịch vụ phải vận hành. Nếu không duyệt Redis, phương án thay thế là bảng phiên PostgreSQL thứ bảy (cần chấp thuận ngoại lệ), hoặc JWT có cơ chế thu hồi và quản lý refresh token tương ứng; JWT đơn thuần không tự giải quyết logout/thu hồi tức thì.

### 4.4. Cấu trúc code dự kiến, chưa tạo

Giữ repositories/read.js và reader pool. Bổ sung middleware authenticated/authorize/CSRF; auth service/repository; stock-movement service/repository; session store adapter; routes auth và POST transactions. Bổ sung JSON parser giới hạn 16 KiB, lỗi body an toàn, request ID/audit, cấu hình credentials writer riêng. Không tái sử dụng pool.query() cho một chuỗi BEGIN/COMMIT; [node-postgres yêu cầu cùng client trong transaction](https://node-postgres.com/features/transactions).

GET dữ liệu dùng reader; auth lookup và POST dùng backend pool. writer không bỏ guard chỉ đọc của reader. Trước ghi, writer preflight phải xác nhận đúng database/role/function owner/path/ACL và không có DML runtime ngoài ý muốn.

Audit nghiệp vụ ghi nhận request_id, transaction_id, actor từ principal server, hướng, điểm quét, kết quả commit/replay/từ chối và số lần retry; log login chỉ kết quả và định danh tối thiểu cần điều tra. Chỉ ghi nhãn thành công sau khi COMMIT đã xác nhận; trường hợp chưa rõ dùng nhãn riêng. Log có quyền truy cập hạn chế và retention được cấu hình, không chứa password/hash/cookie/token/CSRF/SQL đầy đủ. Dùng application_name khác nhau cho reader/writer để phân biệt kết nối khi vận hành.

## 5. Ma trận RBAC đề xuất

| Khả năng | ADMIN | KEEPER | STAFF | VIEWER | Chưa đăng nhập |
| --- | --- | --- | --- | --- | --- |
| GET health trên loopback | Có | Có | Có | Có | Có |
| Login/logout/me/CSRF | Phiên của mình | Phiên của mình | Phiên của mình | Phiên của mình | Chỉ login/CSRF trước login nếu có |
| GET products, inventory, scan-points | Có | Có | Có | Có | 401 |
| GET transactions và bộ lọc hiện có | Toàn bộ | Toàn bộ | Toàn bộ | Toàn bộ | 401 |
| POST transactions IN | Có | Có | 403 | 403 | 401 |
| POST transactions OUT | Có | Có | Có | 403 | 401 |
| Replay UUID đã thành công | Chỉ giao dịch của mình và còn quyền tương ứng | Tương tự | Chỉ OUT của mình | 403 | 401 |
| Sửa/xóa giao dịch lịch sử | Không có API | Không | Không | Không | Không |
| Sửa tồn trực tiếp | Không có API | Không | Không | Không | Không |
| Quản trị tài khoản/role/quyền DB | Chưa thuộc phạm vi API | Không | Không | Không | Không |

Giữ GET lịch sử toàn bộ cho mọi vai trò để bảo toàn semantics giai đoạn 2; không trả actor/user_id. Nếu cần STAFF chỉ xem giao dịch của mình, phải duyệt thay đổi phạm vi dữ liệu riêng; WHERE dựa trên principal server, không dựa trên userId client, và total phải áp cùng điều kiện.

ADMIN là vai trò ứng dụng; không tương đương postgres/superuser. Nếu phê duyệt STAFF được IN như hàm hiện tại thì sửa ma trận và kiểm thử tương ứng trước triển khai, không để backend và DB dùng hai policy khác nhau.

## 6. Chống trùng, retry và transaction

### 6.1. Khóa nghiệp vụ

Mỗi hành động quét được người dùng xác nhận tạo một UUID v4 mới. Frontend giữ UUID cùng payload đến khi kết quả được xác định; retry vì double click, timeout, reconnect dùng **cùng UUID và cùng payload**. Hành động mới tạo UUID mới. UUID không phải bằng chứng quyền và không thay phiên.

Phạm vi UUID là toàn bảng, dựa trên PK hiện có. Cùng UUID nhưng khác actor/scan point/hướng/số lượng/đơn vị hoặc mã quét theo phương án B trả 409; không trả thông tin giao dịch thuộc người khác. Không chỉ SELECT rồi INSERT ở Node, không dựa riêng vào cache hoặc khóa trong RAM.

Khóa bền vững chỉ được lưu khi nghiệp vụ commit thành công. Request bị từ chối/rollback không giữ chỗ UUID và không lưu lại response lỗi: ví dụ xuất thiếu tồn, sau đó được bổ sung tồn, cùng UUID/payload có thể thành công nếu gửi lại. Vì vậy không tự retry lỗi nghiệp vụ; nếu cần bảo toàn cả kết quả thất bại theo khóa thì cần kho idempotency riêng và thiết kế bổ sung, chưa thuộc phương án sáu bảng này.

Hai lần quét cùng hàng nhưng UUID khác là hai nghiệp vụ độc lập. Idempotency không nhận diện được cùng một lần di chuyển vật lý nếu hai thiết bị tự sinh hai ID. Nếu thiết bị phát lại một sự kiện, cả hai lần gửi phải giữ event UUID chung; yêu cầu nhận diện xuyên thiết bị cần giao thức event/chứng từ riêng, không tự deduplicate theo khoảng thời gian/số lượng.

### 6.2. Hai mức hợp đồng idempotency cần chọn

**A — không thêm cột:** dùng UUID và semantic payload đã lưu: actor, scan point, movement, quantity_packages, product_id/product_unit_id tra từ scan_code. Giữ đúng sáu bảng và mọi cột. Điều kiện là scan_code không được gán lại/đổi nghĩa trong vòng đời retry. Hàm hiện còn kiểm active trước duplicate nên replay có thể bị từ chối nếu sản phẩm/điểm quét đã inactive, inventory thiếu hoặc mapping không còn; phải ghi rõ giới hạn, không hứa luôn trả lại thành công. Factor hiện tại thay đổi nhưng cùng unit ID không làm duplicate nhập/xuất lại; trả snapshot cũ. Giai đoạn 3 không tạo API sửa mapping.

**B — đề nghị nếu cần retry bền vững:** thêm `stock_transactions.request_scan_code varchar(80) NULL`. Không backfill phỏng đoán các giao dịch cũ. Hàm ghi mã gốc với mọi giao dịch mới; sau xác thực và kiểm quyền, tra UUID trước khi kiểm trạng thái catalog hiện tại. So sánh actor + scan_point_id + request_scan_code + movement_type + quantity_packages; replay hợp lệ trả bản ghi cũ, không yêu cầu sản phẩm/scan point vẫn active và không tra lại factor. Actor đã inactive hoặc mất quyền vẫn bị từ chối. Cùng mã cũ nhưng sau này được gán sang đơn vị khác vẫn replay kết quả cũ của UUID, không tạo nghiệp vụ mới.

B không cần bảng thứ bảy, không cần request hash, không cần TTL cho khóa đã commit. Bản ghi cũ có request_scan_code=NULL được đọc GET như trước; nếu POST dùng lại UUID cũ thì trả 409 IDEMPOTENCY_LEGACY_RECORD, không giả định payload gốc. Cột không xuất trong GET giai đoạn 2. Không áp NOT NULL toàn bảng vì sẽ đòi sửa dữ liệu cũ.

### 6.3. Gia cố thuật toán sau phê duyệt

- Giữ PK UUID, row lock inventory, ON CONFLICT và rollback nguyên tử. Có thể thêm transaction-scoped advisory lock theo UUID trước khi xử lý để serialize cùng ID, kể cả khi payload đổi sản phẩm; không dùng advisory lock thay PK. Hash collision chỉ tạo chờ thừa, không được làm hai UUID bị coi là một giao dịch.
- Với B: khóa UUID → kiểm user/role hiện tại → đọc/so sánh giao dịch đã có → nếu mới thì kiểm catalog/quantity → khóa inventory → ghi snapshot và tồn. Tất cả caller nghiệp vụ phải dùng thứ tự nhất quán. Kiểm tra đầy đủ NULL/type/length trong hàm, không chỉ ở HTTP.
- Không dùng SKIP LOCKED cho nghiệp vụ tồn kho; không được bỏ qua sản phẩm đang có khóa rồi báo thiếu dữ liệu. Đề xuất READ COMMITTED và transaction ngắn. [PostgreSQL 17 — explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html).
- Không SELECT tồn ở Node rồi tự tính/UPDATE. current_inventory từ nhánh DUPLICATE là snapshot cũ; inventory hiện thời lấy từ GET inventory riêng.
- Metadata/role thay đổi đồng thời: mặc định quyền và catalog được đánh giá khi hàm kiểm tra, request đã được chấp nhận có thể hoàn thành. Nếu yêu cầu thu hồi phải chặn cả nghiệp vụ đang chạy, cần thiết kế khóa bổ sung và review quyền riêng. FOR SHARE trên users/catalog không miễn phí về ACL: PostgreSQL yêu cầu thêm UPDATE trên ít nhất một cột; không tự cấp quyền này chỉ để khóa. [PostgreSQL 17 — SELECT](https://www.postgresql.org/docs/17/sql-select.html).

### 6.4. Retry và kết quả COMMIT không rõ

| Tình huống | Cách xử lý |
| --- | --- |
| CREATED và COMMIT xác nhận | 201; trả giao dịch đã lưu |
| Replay hợp lệ | 200; status DUPLICATE và snapshot cũ; không đổi updated_at tồn |
| Cùng UUID khác payload/actor | 409 IDEMPOTENCY_CONFLICT; không tự sửa request hoặc tạo UUID khác |
| Thiếu tồn/role không đủ/input sai | Không tự retry; người dùng sửa nghiệp vụ và tạo thao tác mới khi phù hợp |
| SQLSTATE 40001 hoặc 40P01 | Rollback và retry **toàn bộ transaction** với cùng UUID/payload; tối đa 2 lần retry, exponential backoff có jitter trong deadline |
| Lock timeout 55P03 / statement timeout 57014 | Rollback; có thể trả 503 STOCK_BUSY + Retry-After; client retry cùng UUID, không vòng lặp vô hạn |
| Mất kết nối/timeout lúc COMMIT | Không biết đã commit hay chưa: loại bỏ client lỗi; reconnect và xử lý lại bằng cùng UUID để tra kết quả/replay. Nếu chưa xác định được, trả 503 TRANSACTION_OUTCOME_UNKNOWN với cùng transaction_id |
| DB/Redis không sẵn sàng | 503; không fallback tài khoản quản trị hoặc bỏ qua auth |

Đề xuất lock_timeout 1 giây, statement_timeout 5 giây, toàn request ghi tối đa 10 giây; retry chỉ khi còn ngân sách thời gian. Giá trị phải được đo trên môi trường thử nghiệm. Không chỉ tăng timeout toàn cục. Nhận HTTP timeout không chứng minh DB rollback; client không đổi UUID để thử lại.

## 7. Hợp đồng API đề xuất

Base `/api`; JSON UTF-8; no-store; lỗi giữ `{ "error": { "code": "...", "message": "..." } }`. bigint luôn là chuỗi. Cả `/transactions` và `/transactions/` cùng hợp đồng, không redirect POST làm mất method/body.

### 7.1. Auth

| Endpoint | Request | Thành công | Lỗi chính |
| --- | --- | --- | --- |
| POST /auth/login | `{ "username": "...", "password": "..." }`, chỉ hai field | 200 data user_id:string, username, display_name, role; Set-Cookie phiên mới | 400/413/415 input, 401 INVALID_CREDENTIALS, 429, 503 |
| GET /auth/me | Cookie phiên | 200 cùng identity projection, không hash/token | 401/503 |
| GET /auth/csrf | Cookie phiên | 200 `{ "data": { "csrf_token": "..." } }` | 401/503; luồng CSRF trước login nếu chọn phải có hợp đồng riêng |
| POST /auth/logout | Cookie + CSRF, body rỗng | 204; thu hồi phiên và xóa cookie | 403 CSRF; có thể 204 khi phiên đã hết để logout idempotent |

Không trim/lowercase password; giới hạn kích thước password trước verifier, thông số cụ thể theo thư viện/thuật toán được duyệt. Identity response có user_id/role là dữ liệu từ server dành cho UI; client không được dùng lại chúng để tự xác lập quyền. Không áp projection auth này cho GET transactions.

### 7.2. POST /transactions

Yêu cầu phiên hợp lệ, CSRF, Content-Type application/json. Body allowlist chính xác:

```json
{
  "transaction_id": "b5e4a793-e1b6-44f4-8f45-3338eb1049a1",
  "scan_point_id": "MA_DIEM_QUET",
  "scan_code": "MA_QUET_DON_VI",
  "movement_type": "OUT",
  "quantity_packages": 2
}
```

Ví dụ là payload minh họa, không khẳng định mã trên tồn tại. transaction_id UUID v4 không nil; normalize chữ hex để đối chiếu. scan_point_id 1–20 ký tự, scan_code 1–80 ký tự, không NUL/không chỉ khoảng trắng; từ chối khoảng trắng đầu/cuối để không âm thầm đổi mã. movement_type chính xác IN/OUT. quantity_packages là JSON number nguyên 1–2147483647 theo kiểu integer; không nhận chuỗi, decimal, boolean. Đây là trần kỹ thuật; giới hạn số gói nhỏ hơn theo vận hành là quyết định riêng.

Không nhận product_id, product_unit_id, user_id, role, quantity_base, conversion_factor_snapshot, inventory_after hoặc created_at. Backend/DB xác định các giá trị này. Không hỗ trợ Idempotency-Key header song song ở phiên bản đầu, tránh hai khóa không đồng nhất.

201 khi mới tạo; 200 khi replay. Response có cấu trúc:

```json
{
  "data": {
    "transaction_id": "b5e4a793-e1b6-44f4-8f45-3338eb1049a1",
    "product_id": "MA_SAN_PHAM",
    "product_unit_id": "123",
    "scan_point_id": "MA_DIEM_QUET",
    "movement_type": "OUT",
    "quantity_packages": 2,
    "conversion_factor_snapshot": 10,
    "quantity_base": "20",
    "inventory_after": "80",
    "created_at": "2026-11-03T00:00:00.000Z"
  },
  "meta": { "result_status": "CREATED" }
}
```

Số liệu response trên chỉ minh họa. Với replay, meta.result_status=DUPLICATE; data lấy từ transaction đã lưu, không dựng lại snapshot/time bằng giá trị hiện tại. Không trả actor/password/hash. POST không cần trả tên hiện tại của product/unit/scan point để tránh nhầm tính bất biến của response replay. Chưa đề xuất Location vì chưa có GET transaction detail.

### 7.3. GET /transactions và /transactions/

Giữ nguyên query và projection ở REST_API.md: page=1, limit=20, tối đa 100; productId, movementType=IN/OUT, scanPointId; kết hợp AND. Không thêm userId query. Vai trò có quyền xem toàn bộ theo ma trận; chưa đăng nhập trả 401.

200: `{ "data": [...], "count": 0, "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 } }`, count=data.length. Giữ các trường transaction_id, product_id, product_name, product_unit_id, unit_name, scan_point_id, point_name, movement_type, quantity_packages, conversion_factor_snapshot, quantity_base, inventory_after, created_at. Không thêm password_hash/user_id/role/request_scan_code. Tên qua JOIN là tên hiện tại; snapshot/factor/số lượng lấy từ lịch sử đã lưu.

Giữ ORDER BY created_at DESC, transaction_id DESC; count và page cùng snapshot. Đây là thứ tự hiển thị ổn định, **không phải thứ tự COMMIT tuyệt đối**: created_at=now() là thời điểm bắt đầu transaction, UUID không biểu diễn commit order. Khi có ghi đồng thời giữa các request trang, offset pagination có thể lặp/bỏ hàng; không dùng nó để đồng bộ sự kiện. Cursor/change-feed là mở rộng sau, chưa cần index hoặc schema mới ở giai đoạn này.

### 7.4. Bảng status và lỗi ghi

| HTTP / code | Ý nghĩa |
| --- | --- |
| 400 INVALID_BODY / INVALID_QUERY | JSON/query/UUID/type/unknown field sai; malformed JSON không thành 500 |
| 401 AUTHENTICATION_REQUIRED / INVALID_CREDENTIALS | Thiếu/hết phiên hoặc đăng nhập thất bại |
| 403 FORBIDDEN / CSRF_FAILED | Không đủ quyền hướng nghiệp vụ hoặc CSRF không hợp lệ |
| 409 IDEMPOTENCY_CONFLICT | UUID khác payload/actor; không tiết lộ giao dịch khác |
| 409 IDEMPOTENCY_LEGACY_RECORD | Phương án B: UUID cũ thiếu request_scan_code, không thể chứng minh replay |
| 409 INSUFFICIENT_INVENTORY | Xuất vượt tồn; rollback toàn bộ |
| 409 STOCK_LIMIT_EXCEEDED | Kết quả tồn vượt bigint/giới hạn vận hành |
| 413 PAYLOAD_TOO_LARGE / 415 UNSUPPORTED_MEDIA_TYPE | Body quá lớn/không JSON |
| 422 INVALID_SCAN_CODE / INVALID_SCAN_POINT | Mã không tồn tại hoặc inactive cho nghiệp vụ mới |
| 422 PRODUCT_INACTIVE | Sản phẩm ngừng hoạt động khi xử lý nghiệp vụ mới |
| 429 TOO_MANY_REQUESTS | Vượt giới hạn, có Retry-After |
| 500 INVENTORY_STATE_INVALID | Catalog có sản phẩm nhưng thiếu inventory; lỗi bất biến dữ liệu, cần vận hành xử lý, không tự tạo |
| 500 INTERNAL_SERVER_ERROR | Quyền/schema/lỗi nội bộ không được phân loại công khai |
| 503 DATABASE_UNAVAILABLE / SESSION_STORE_UNAVAILABLE / STOCK_BUSY | Không sẵn sàng; retry theo chính sách |
| 503 TRANSACTION_OUTCOME_UNKNOWN | Chưa xác định COMMIT, retry cùng UUID |

Hàm cần SQLSTATE riêng theo từng nhóm nghiệp vụ (ví dụ namespace PZxxx với mã không kết thúc 000), mapping allowlist trong backend. Lỗi constraint/42501 ngoài dự kiến không được giả làm lỗi client. Không gửi message/detail/context SQL trực tiếp. Thiếu inventory trên GET vẫn 404 INVENTORY_NOT_FOUND như hợp đồng cũ; POST thiếu inventory là lỗi trạng thái nội bộ khác ngữ cảnh.

## 8. Phương án quyền PostgreSQL tối thiểu

### 8.1. Phương án khuyến nghị: runtime EXECUTE, DML chỉ trong owner nghiệp vụ

| Chủ thể | Quyền dự kiến | Không có |
| --- | --- | --- |
| warehouse_readonly | Giữ CONNECT, USAGE public, SELECT năm bảng hiện tại; default_transaction_read_only=on | Không users, DML, EXECUTE record_stock_movement sau khi harden |
| warehouse_backend (LOGIN riêng) | CONNECT DB, USAGE public, EXECUTE đúng chữ ký record_stock_movement; SELECT các cột stock_transactions cần cho POST response; SELECT users chỉ các cột user_id, username, display_name, role, password_hash, is_active | Không INSERT/UPDATE/DELETE/TRUNCATE, CREATE schema/DB, quyền sequence, membership owner hoặc GRANT OPTION |
| warehouse_stock_executor (NOLOGIN owner function) | USAGE public; SELECT các cột cần trong users/product_units/products/scan_points/inventory/stock_transactions; INSERT các cột ghi trên stock_transactions; UPDATE inventory(quantity_base,updated_at), stock_transactions(inventory_after) | Không password_hash, UPDATE users/catalog, DELETE, TRUNCATE, SUPERUSER, BYPASSRLS, tạo DB/role, ownership bảng |

Phạm vi SELECT của backend trên stock_transactions: transaction_id, product_id, product_unit_id, scan_point_id, movement_type, quantity_packages, conversion_factor_snapshot, quantity_base, inventory_after, created_at. Không cần user_id hoặc request_scan_code để dựng POST response; không cấp SELECT toàn bảng chỉ vì thuận tiện.

Phạm vi SELECT của owner nghiệp vụ tối thiểu: users(user_id,role,is_active); products(product_id,is_active); product_units(product_id,product_unit_id,conversion_factor,scan_code); scan_points(scan_point_id,is_active); inventory(product_id,quantity_base); các cột giao dịch dùng đối chiếu và RETURNING. Hàm hiện SELECT * vào stock_transactions%ROWTYPE nên cần SELECT toàn bộ bảng này nếu giữ nguyên; nếu thu hẹp grant thì phải thay projection tương ứng khi triển khai. Phương án B thêm quyền INSERT/SELECT request_scan_code cho owner, không cần cấp cột đó cho backend.

INSERT owner: transaction_id, product_id, product_unit_id, scan_point_id, user_id, movement_type, quantity_packages, conversion_factor_snapshot, inventory_after, và request_scan_code nếu B; created_at dùng default, quantity_base do generated nên không gán trực tiếp. UPDATE inventory đã đủ phần quyền UPDATE cần cho FOR UPDATE trên chính inventory. Không cấp UPDATE users chỉ để kiểm role. Không cần sequence vì POST dùng UUID và không tạo user/unit.

Quyền đọc hash cho warehouse_backend chỉ phục vụ verifier; vẫn có rủi ro credential này bị lộ sẽ đọc được các cột hash của nhiều user. Nếu yêu cầu giảm thêm khả năng enumerate, có thể thay SELECT users bằng hai function lookup theo username/user_id trong schema auth riêng, owner NOLOGIN chỉ đọc cột auth và EXECUTE chỉ cho backend; vẫn phải chấp nhận backend có thể gọi lookup nhiều lần. Đây là phương án tăng hardening, chưa bắt buộc thêm object ở cấu hình tối thiểu.

### 8.2. Điều kiện bắt buộc trước khi bật SECURITY DEFINER

1. Đổi owner sang warehouse_stock_executor NOLOGIN, không superuser, không là owner bảng. Backend không được là member/SET ROLE sang role owner. Quản trị viên giữ vai trò áp thay đổi, không dùng trong runtime.
2. Function SET search_path cố định, đề nghị `pg_catalog, public, pg_temp`; schema ứng dụng phải không writable đối với runtime/PUBLIC. Dùng public.users/public.inventory/... và public.stock_transactions%ROWTYPE rõ ràng; không dynamic SQL từ request.
3. Thu hồi EXECUTE PUBLIC cho **đúng function signature** trước/đồng thời đổi mode, rồi cấp đúng warehouse_backend. Kiểm cả grant trực tiếp, PUBLIC và membership; REVOKE riêng warehouse_readonly không loại được quyền qua PUBLIC.
4. Thay owner/mode/path/ACL và kiểm tra trong **một transaction quản trị**, tránh cửa sổ DEFINER còn PUBLIC EXECUTE. Giữ INVOKER trong lúc thay body/path; chuyển owner sang executor và kiểm owner NOLOGIN tối thiểu **trước** khi bật SECURITY DEFINER. Không có bước nào bật DEFINER khi owner vẫn là postgres.
5. Runtime không được ownership/CREATE/GRANT OPTION/role quản trị, không ALL PRIVILEGES/ALL TABLES/ALL FUNCTIONS hoặc quyền ghi trực tiếp lên inventory/lịch sử.
6. Mọi function phụ có thể dẫn tới ghi phải có ACL được rà soát. Trigger create_inventory_for_product hiện INVOKER và không có API INSERT products; không cấp INSERT products để tận dụng trigger.
7. Quyền mặc định của function mới cần cấu hình theo role thực sự tạo object, ở phạm vi phù hợp; không GRANT EXECUTE hàng loạt. Quyền mặc định không sửa ACL object đang tồn tại. [PostgreSQL — ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).

Đây là đề xuất quyền, không phải script cấp quyền đã chạy. Cấu hình ACL/ownership phải được DBA chuẩn bị, review và xác minh riêng sau phê duyệt. Quyền hiệu lực phải tính cả PUBLIC/membership/quyền cột, không chỉ nhìn một dòng GRANT. [PostgreSQL — Privileges](https://www.postgresql.org/docs/17/ddl-priv.html).

### 8.3. Vì sao không giữ INVOKER rồi chỉ cấp EXECUTE?

EXECUTE riêng không đủ cho hàm INVOKER hiện tại. Caller còn phải đọc users và có INSERT/UPDATE bảng lịch sử/tồn kho. Cấp những quyền đó cho runtime mở đường bỏ qua hàm, tự sửa snapshot/tồn và giả actor; không đáp ứng mục tiêu quyền tối thiểu. Wrapper DEFINER gọi hàm INVOKER chỉ an toàn khi wrapper cũng được harden, owner không superuser và không còn đường gọi ghi không kiểm soát; thêm wrapper không tự giải quyết rủi ro.

### 8.4. Rủi ro nâng warehouse_readonly thành tài khoản nghiệp vụ

| Rủi ro | Hậu quả | Giảm thiểu |
| --- | --- | --- |
| Credentials cũ đã được dùng ở API đọc/test/công cụ | Mọi nơi giữ credentials có thêm khả năng ghi | Giữ role này chỉ đọc; credential writer riêng, chỉ service cần dùng |
| EXECUTE PUBLIC hiện có + đổi hàm DEFINER | Read role cũng có thể đi vào đường ghi | Thu hồi PUBLIC trong cùng đợt hardening; kiểm quyền hiệu lực=false với reader |
| Chỉ dựa vào default_transaction_read_only | Caller đổi sang READ WRITE được khi có ACL ghi | ACL quyết định; không xem setting là thay quyền |
| Cấp DML để INVOKER chạy được | Bỏ qua kiểm tồn/RBAC/snapshot trong hàm | Runtime chỉ EXECUTE hàm harden |
| Đọc users/hash trên reader | Các API/tools đọc kho thành điểm lộ credential ứng dụng | Giữ users hoàn toàn ngoài quyền reader |
| Preflight/test giai đoạn 2 không còn đúng | Mất bằng chứng read-only, phải sửa assertion bảo mật | Tách writer preflight/tests, giữ check cũ cho reader |
| Thu hồi/rollback dùng chung role | Ngắt cả API đọc và ghi; khó tách audit | Role/pool/app_name riêng, vô hiệu writer độc lập |

Nếu vẫn yêu cầu dùng một role thì phải duyệt rõ việc role không còn read-only, toàn bộ nơi dùng credential cần được kiểm kê và quyền users/EXECUTE/DML phải review lại. Không khuyến nghị lựa chọn này. Dù dùng role mới, backend bị chiếm quyền vẫn có thể gọi function với p_user_id của người khác: DB không xác minh phiên trình duyệt. Parameterization, hạn chế đường SQL, quản lý bí mật và audit là phần bắt buộc; không tuyên bố RBAC trong function giải quyết được backend compromise.

## 9. Thay đổi schema và tương thích

| Đề xuất | Có cần cho giai đoạn 3? | Lý do / tác động |
| --- | --- | --- |
| Đổi cấu trúc users | Không bắt buộc | Đã có username/role/hash/active; NULL hash bị từ chối login. Không đặt NOT NULL trước khi xác minh dữ liệu |
| Thêm bảng users/roles | Không | Bốn role đã có CHECK; không cần bảng thứ bảy cho RBAC cố định |
| Thêm request_scan_code nullable vào stock_transactions | Cần nếu chọn idempotency B, khuyến nghị cho replay bền vững | Lưu input gốc; không suy ra từ mapping có thể đổi; dữ liệu cũ giữ nguyên |
| Thêm bảng idempotency | Không | PK transaction_id hiện tại bảo vệ khóa thành công lâu dài |
| Bảng session PostgreSQL | Không nếu Redis được duyệt | Redis giữ nguyên số bảng; nếu chọn PG store phải duyệt bảng thứ bảy |
| Sửa function owner/security/path/ACL/body | Cần với thiết kế khuyến nghị | Đây là thay đổi DB object có chủ ý, cần phê duyệt dù không đổi bảng |
| Index mới | Chưa bắt buộc | Giữ index hiện có; chỉ thêm sau EXPLAIN/đo trên dữ liệu đại diện |
| auth_version/password_changed_at, request fingerprint, snapshot tên | Hoãn | Chỉ thêm khi có yêu cầu thu hồi password/metadata/audit cụ thể |

Không sửa/xóa lịch sử, không tính lại quantity_base bằng factor hiện tại, không tự sửa tồn để khớp tổng giao dịch. Không khẳng định tổng lịch sử bằng tồn nếu dữ liệu ban đầu có số dư mở sổ chưa ghi lịch sử. Giữ bigint dạng chuỗi, FK kép unit-product, no-store và projection không users của GET cũ.

## 10. Kế hoạch kiểm thử sau phê duyệt

### 10.1. Môi trường và nguyên tắc

DB thử nghiệm riêng có cùng version/schema/function/ACL, dữ liệu giả và test accounts đủ bốn role; mật khẩu test không lấy từ production và không in hash. Tạo fixture chỉ sau phê duyệt triển khai/test, không chạy trên smart_warehouse hiện tại. Đánh dấu rõ test thật, mock và trường hợp chưa kiểm chứng. Dùng ít nhất hai connection DB và hai phiên HTTP độc lập cho concurrency, barrier để tạo overlap thực sự, không chỉ Promise.all trên cùng client.

Kiểm quyền phủ định bằng thực thi DML chỉ trên DB thử nghiệm; trên DB hiện có chỉ đọc catalog. Chạy hồi quy 36/36 và 10/10 theo mục tiêu cũ, cập nhật auth fixture cho GET được bảo vệ chứ không xóa assertions. Suite giai đoạn 2 thuần đọc tiếp tục dùng reader; suite ghi riêng không dùng phép audit yêu cầu dữ liệu luôn bất biến.

### 10.2. KT1 — Đăng nhập, phiên và RBAC

1. Login hợp lệ cho bốn role; response/cookie không lộ password/hash/session token JSON; phiên mới sau login, token cũ không dùng được.
2. Sai password, username không tồn tại, inactive, NULL/rỗng/hash placeholder/unsupported: cùng 401 chung; không bypass; throttle 429; không ghi password/hash vào log.
3. Cookie hết hạn, logout, Redis lỗi, DB lỗi; idle và absolute expiry đúng, không phục hồi phiên bằng RAM. Chạy nhiều instance dùng chung session nếu cấu hình triển khai có nhiều instance.
4. Không đăng nhập GET dữ liệu/POST nhận 401; VIEWER ghi 403; STAFF IN 403, OUT được; KEEPER/ADMIN IN/OUT được theo ma trận đã duyệt.
5. Gửi user_id/role/X-User-Id/X-Role giả: body ngoài hợp đồng bị 400, header không ảnh hưởng principal. user_id trong giao dịch DB phải bằng principal thật.
6. CSRF thiếu/sai, Origin không cho phép, cookie flags, JSON/body quá lớn, SQL injection và query lặp; không trả SQL/stack/hash. Hết quyền sau đổi role/inactive phải ảnh hưởng request kế tiếp; request đang chạy kiểm theo chính sách đã công bố.
7. Reader không EXECUTE hàm nghiệp vụ sau hardening, không users/DML; backend chỉ EXECUTE + SELECT cho phép; không SET ROLE sang owner, không CREATE/ownership/quyền sequence ngoài ý muốn.

### 10.3. KT2 — Nhập/xuất và rollback

Dữ liệu giả cố định: tồn đầu 100 đơn vị cơ sở, factor=10, hai điểm quét active, actor KEEPER. Đây không phải số liệu DB hiện tại.

| Ca | Thao tác | Kỳ vọng |
| --- | --- | --- |
| KT2.1 | IN 3 gói | 201; quantity_base="30"; tồn 130; snapshot=10; đúng actor/điểm quét |
| KT2.2 | Sau KT2.1, OUT 4 gói | 201; quantity_base="40"; tồn 90; inventory_after="90" |
| KT2.3 | OUT 10 gói khi tồn 90 | 409 thiếu tồn; không có transaction mới, tồn/updated_at không đổi |
| KT2.4 | Số 0/âm/decimal/chuỗi/quá int32, UUID sai/NULL/field lạ | 400 trước ghi; gọi DB trực tiếp trên test cũng không vượt validation/constraints |
| KT2.5 | Mã sai, inactive product/point | 422 cho nghiệp vụ mới; không đổi dữ liệu |
| KT2.6 | Sản phẩm có nhưng thiếu inventory | Lỗi trạng thái nội bộ; không tự INSERT tồn |
| KT2.7 | Factor đổi sau giao dịch | GET/replay giữ quantity_base và factor snapshot cũ |
| KT2.8 | Lỗi sau INSERT trước cập nhật cuối/overflow bigint | Rollback cả inventory và transaction, không lưu hàng tạm |

Sau mỗi ca đối chiếu SELECT độc lập, đúng FK kép và inventory_after; GET cũ giữ response/filters/pagination, OUT quantity luôn dương. Không chỉ assert status HTTP.

### 10.4. KT3 — Chống trùng và retry

1. POST thành công rồi gửi lại cùng UUID/payload/actor: lần đầu 201, lần sau 200 DUPLICATE; một hàng lịch sử, chỉ một delta tồn, inventory.updated_at không đổi lần replay.
2. Dùng UUID cũ đổi từng field quantity/hướng/điểm quét/mã/actor: 409, không lộ actor cũ, không ghi thêm. Dùng cùng actor nhưng phiên mới vẫn replay được nếu còn quyền.
3. Sau giao dịch khác làm tồn thay đổi, replay UUID cũ trả inventory_after cũ; không trả tồn hiện tại dưới tên snapshot.
4. Giả lập mất HTTP response sau COMMIT rồi retry cùng UUID: không ghi hai lần. Giả lập lỗi trước COMMIT: rollback, retry cùng UUID có thể tạo một lần.
5. Gây 40001/40P01 ở test: retry cả transaction với cùng ID, có giới hạn và jitter; hết deadline trả lỗi retryable an toàn. Không retry 403/409 conflict/422.
6. Nếu A: kiểm replay khi mapping/active thay đổi theo giới hạn đã duyệt. Nếu B: replay sau đổi factor/mapping/inactive catalog vẫn trả giao dịch gốc; UUID của actor khác xung đột; UUID legacy NULL mã gốc trả IDEMPOTENCY_LEGACY_RECORD.
7. Hai UUID khác cho cùng payload được xử lý như hai nghiệp vụ; không vô tình deduplicate bằng nội dung hoặc thời gian.

### 10.5. Concurrency — Hai điểm quét đồng thời

Mỗi ca reset fixture ở DB thử nghiệm; điểm A/B và UUID A/B khác nhau trừ khi ca quy định giống. Không suy ra kết quả từ thứ tự gửi request.

| Ca | Tồn đầu và request đồng thời | Bất biến phải chứng minh |
| --- | --- | --- |
| C1 | Tồn 100; A OUT 80, B OUT 80 (đơn vị cơ sở) | Đúng một thành công, một thiếu tồn; cuối 20; một transaction; không âm |
| C2 | Tồn 100; A OUT 30, B OUT 40 | Cả hai thành công; cuối 30; hai snapshot tạo một chuỗi hợp lệ theo thứ tự khóa |
| C3 | Tồn 100; A IN 20, B OUT 70 | Cả hai thành công; cuối 50; không lost update |
| C4 | Cùng UUID và toàn bộ payload, phát qua hai connection | Một CREATED, một DUPLICATE; một delta. Payload phải cùng scan_point_id; khác điểm quét là ca C5 |
| C5 | Cùng UUID, một request từ A và một từ B | Một CREATED, một 409 do scan_point_id khác; một delta |
| C6 | Cùng UUID nhưng khác sản phẩm | Một CREATED, một 409; sản phẩm thua không đổi; kiểm cả PK/ON CONFLICT và advisory lock nếu thêm |
| C7 | UUID khác, sản phẩm khác | Có thể chạy song song, không khóa toàn kho; nếu advisory hash va chạm chỉ chờ thêm, không nhầm duplicate |
| C8 | Giữ khóa tồn ở session A, request B vượt lock timeout | B trả STOCK_BUSY sau rollback; không có giao dịch tạm; retry cùng UUID thành công sau khi nhả khóa |
| C9 | A đã INSERT/cập nhật nhưng chưa COMMIT rồi bị ngắt | B chỉ dựa trên trạng thái đã commit; A rollback không để giao dịch ma; retry có đúng một kết quả commit |
| C10 | A commit thành công nhưng client mất kết nối | Replay từ B cùng payload xác định kết quả, không nhân đôi tồn |

Lặp ca có tranh chấp với barrier và nhiều lịch xen kẽ, ghi transaction_id/status/tồn trước-sau/mức isolation/thời gian chờ; không log mật khẩu/hash/cookie/CSRF. Một lần chạy thuận lợi không đủ kết luận concurrency an toàn.

## 11. Rủi ro còn lại và cách giảm thiểu

| Rủi ro | Biện pháp / giới hạn |
| --- | --- |
| Chưa biết test account/hash khả dụng | DBA trả metadata boolean, rồi xác minh verifier có kiểm soát; không tự reset/seed tài khoản |
| DEFINER owner postgres hoặc path không an toàn | Owner NOLOGIN tối thiểu, schema-qualified, path cố định, ACL allowlist; review trước khi mở POST |
| Backend credential lộ | Tách reader/writer, hạn chế SELECT hash, secret ngoài frontend/log, không quyền DML/owner; runtime bị chiếm vẫn có thể giả actor qua function |
| CSRF/session hijack/brute force | Cookie phù hợp môi trường, CSRF+Origin, token rotation/TTL/revoke, rate limit chia sẻ |
| DBA đổi role/hash/catalog giữa request | Role lookup từng request, policy request đang chạy rõ ràng; đổi password phải revoke sessions; metadata maintenance có kiểm soát |
| Replay sau catalog đổi nghĩa | Chọn B nếu cần đảm bảo theo input gốc; A phải ghi rõ điều kiện và cấm gán lại scan_code trong vòng đời retry |
| UUID mới khi retry hoặc hai scanner không dùng event ID chung | Lưu pending UUID/payload ở client, quy trình event ID; không tuyên bố chống được trùng vật lý bằng PK đơn thuần |
| Deadlock/khóa nóng/DoS | Transaction ngắn, timeout, retry có hạn, pool giới hạn, rate limit; đo tải thay vì tăng pool vô hạn |
| Kết quả COMMIT không rõ | Reconnect/replay cùng UUID; TRANSACTION_OUTCOME_UNKNOWN không phải kết luận rollback |
| Dữ liệu lịch sử ít, chưa đo tải lớn | DB test dữ liệu đại diện; đo query/lock/pool trước quyết định index |
| Timestamp không là commit order; nhiều trang khi đang ghi | Giữ hợp đồng hiển thị, refresh lịch sử phù hợp; change-feed/cursor là phạm vi sau |
| Quyền PUBLIC ngoài phạm vi hàm cụ thể | Catalog audit trước hardening; không tự REVOKE hàng loạt ảnh hưởng ứng dụng khác |
| Khôi phục triển khai sau khi đã có giao dịch | Tắt POST/thu hồi writer EXECUTE, giữ API đọc; không xóa giao dịch để rollback release |

## 12. Trình tự thực hiện sau phê duyệt

1. Chốt các quyết định bên dưới và kiểm tra an toàn tài khoản thử nghiệm. Chưa có account/hash hợp lệ thì không đánh dấu auth integration sẵn sàng.
2. Chuẩn bị DB thử nghiệm/Redis, role/ACL dự kiến và diff function/schema để review; có bản sao định nghĩa/quyền và phương án khôi phục. Không dùng runtime làm quản trị viên.
3. DBA áp thay đổi được duyệt trên DB thử nghiệm; xác minh owner/path/PUBLIC/membership/quyền cột bằng catalog trước khi chạy ghi.
4. Triển khai auth/session/RBAC, giữ reader pool, bổ sung writer và POST/error/audit. Test KT1→KT2→KT3→concurrency, hồi quy GET.
5. Review kết quả thật và giới hạn còn lại. Chỉ áp thay đổi lên DB đang dùng trong bước triển khai đã được người dùng cho phép; không tự áp vì kế hoạch này tồn tại.
6. Sau triển khai, quan sát lỗi auth/409/lock wait/retry và audit actor; không log request login/hash/token. Khóa đường ghi độc lập nếu có sự cố, giữ dữ liệu đã commit để xử lý bằng nghiệp vụ được duyệt.

## 13. Các quyết định kiến trúc đã được phê duyệt có điều kiện

| Mã | Quyết định | Đề nghị |
| --- | --- | --- |
| D1 | Giữ reader hay nâng warehouse_readonly? | Giữ nguyên reader; tạo warehouse_backend và owner NOLOGIN riêng |
| D2 | Mode/owner/path/ACL và sửa function | Duyệt hardening SECURITY DEFINER với owner tối thiểu, bỏ PUBLIC EXECUTE, SQLSTATE nghiệp vụ; không nâng hàm owner postgres nguyên trạng |
| D3 | Quyền STAFF | STAFF chỉ OUT; ADMIN/KEEPER IN+OUT; VIEWER chỉ đọc |
| D4 | Auth cho GET và phạm vi lịch sử | Sáu GET dữ liệu cần login, giữ schema response; mọi role xem lịch sử toàn bộ; health loopback giữ công khai |
| D5 | Phiên và hạ tầng | Tạm chọn Redis opaque session, idle 30 phút/absolute 8 giờ, cookie/CSRF; cần chứng minh môi trường chạy ổn định trước triển khai |
| D6 | Mức idempotency | Đã chọn B: thêm request_scan_code nullable, không backfill và không thêm bảng PostgreSQL |
| D7 | Quyền auth đọc hash | Đã duyệt chỉ warehouse_backend SELECT các cột auth cần thiết; không trả hash qua API |
| D8 | Tài khoản thử nghiệm và password | Chỉ kiểm metadata an toàn; thiết lập hash nếu cần phải có quy trình riêng được duyệt, không tự reset |
| D9 | Môi trường kiểm thử ghi | Đã chốt DB thử nghiệm riêng; môi trường/role/script cụ thể vẫn phải được duyệt trước khi chạy và triển khai Auth |
| D10 | Hợp đồng POST/retry và trần nghiệp vụ | Đã duyệt UUID trong body, 201/200/409, retry cùng UUID và rollback; trần kỹ thuật int32, giới hạn vận hành nhỏ hơn nếu cần sẽ chốt riêng |

Phê duyệt kiến trúc không thay thế việc xem xét quyền/DDL cụ thể. Các cấu hình và script review đã được chuẩn bị tại infra/phase3 và scripts/phase3 theo [báo cáo chuẩn bị](PHASE3_PREPARATION.md), nhưng chưa được áp dụng. Chưa triển khai code Auth/RBAC/Session/POST hoặc chạy migration/GRANT/ALTER FUNCTION; không thay đổi smart_warehouse chính.
