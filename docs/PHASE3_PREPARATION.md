# Giai đoạn 3 — Báo cáo chuẩn bị môi trường và script

Ngày kiểm tra: 03/11/2026, Asia/Bangkok. Trạng thái: **chỉ chuẩn bị; chưa khởi chạy hạ tầng, chưa áp SQL, chưa triển khai Auth/RBAC/Session/API ghi**.

Kiến trúc trong PHASE3_PLAN.md đã được chủ dự án phê duyệt có điều kiện. Báo cáo này là bước A–B: kiểm tra thực tế, chuẩn bị thay đổi cụ thể và chờ duyệt môi trường/quyền. Xem thêm [đánh giá bảo mật và rollback](PHASE3_SECURITY_REVIEW.md), [SQL diff](PHASE3_SQL_DIFF.patch).

## 1. Môi trường Windows hiện tại

| Hạng mục | Bằng chứng đã kiểm tra | Kết luận |
| --- | --- | --- |
| Windows | Windows 11 Home Single Language, build 26200 | Phù hợp hướng Linux containers qua WSL2; chưa đo tải/RAM cho demo |
| Docker Desktop | File Docker Desktop.exe phiên bản 4.72.0.225998 | Đã cài; không cần đề xuất cài lại ở bước này |
| Docker CLI / Compose | Docker 29.4.2; Compose v5.1.3 | Có công cụ CLI |
| Docker engine | docker info và docker ps không kết nối được named pipe dockerDesktopLinuxEngine | **Chưa hoạt động/chưa sẵn sàng**; chưa kiểm được image/container qua daemon |
| Docker service | com.docker.service Stopped, Manual | Chưa tự khởi động hoặc đổi startup |
| WSL | Package 2.7.3.0, kernel 6.6.114.1-1; default version 2 | WSL2 đã có |
| Distribution | docker-desktop, Version 2, Stopped; WSLService Running | Có distro Docker; chưa cần cài Ubuntu riêng |
| Redis native | Không thấy redis-server/redis-cli trong PATH, không thấy service Redis qua tên | Chưa chứng minh không có binary ở mọi thư mục; không tìm thấy Redis native đang phục vụ |
| Redis TCP | 127.0.0.1:6379 và :6380 đều ECONNREFUSED | **Chưa kết nối Redis được**; chưa có PONG/auth/ACL/persistence test |
| PostgreSQL chính | PostgreSQL 17.11, service Running/Automatic, kết nối thật thành công | Chỉ kiểm tra bằng warehouse_readonly |
| Cổng PostgreSQL chính | Listener 0.0.0.0:5432 và [::]:5432 | Listener không giới hạn loopback; khả năng truy cập LAN còn phụ thuộc firewall/pg_hba. Không tự thay cấu hình |
| Cổng test dự kiến | TCP 127.0.0.1:5433 ECONNREFUSED | Chưa có server test nghe cổng này lúc kiểm tra |
| PostgreSQL tools | psql.exe và pg_dump.exe 17.11 tại C:\Program Files\PostgreSQL\17\bin | Có sẵn, dù chưa nằm trong PATH; không cần cài thêm chỉ để dùng CLI |
| Node | v24.15.0 | Giữ dependencies hiện tại; chưa cài Redis client hoặc thư viện hash |

Lần kiểm tra trong sandbox bị hạn chế quyền đọc Docker config/WSL/CIM. Đã kiểm tra lại chỉ đọc ngoài sandbox sau khi được cấp quyền; không hiển thị nội dung Docker config hay credentials. Không cài phần mềm, mở Docker Desktop, bật WSL distro, khởi động container hoặc chỉnh firewall.

Docker Desktop hiện có và WSL2 tạo được hướng triển khai khả thi; chưa đủ bằng chứng để gọi phương án này “đã chạy ổn định”. Cần hoàn tất health/restart/ACL test ở mục 7. Windows Home dùng Linux containers, không chọn Windows containers. Đối chiếu [Docker Desktop Windows requirements](https://docs.docker.com/desktop/setup/install/windows-install/).

## 2. Phương án Redis đề nghị để demo

### 2.1. Docker Compose trên WSL2 đã cài

Đề nghị dùng `infra/phase3/compose.review.yaml` với hai service tách network:

- Redis cho session/rate limiter: publish **127.0.0.1:6379**; không publish 0.0.0.0 hoặc IPv6 wildcard trên host.
- PostgreSQL test trong **cluster/container riêng**, publish **127.0.0.1:5433**, database smart_warehouse_phase3_test; không dùng service PostgreSQL Windows ở 5432.
- Không mount thư mục dữ liệu PostgreSQL chính hoặc .env chính. Không có init SQL tự chạy, migration/fixtures chỉ thực hiện thủ công sau review.
- Redis image ứng viên `redis:8.10.3-alpine`; PostgreSQL `postgres:17.11-bookworm`. Tag được đối chiếu danh sách official images, nhưng **chưa pull hoặc chạy trên máy này**. Trước demo phải chọn digest thực tế của đúng image/platform; template cố ý để placeholder digest không dùng được. [Redis official image](https://hub.docker.com/_/redis), [PostgreSQL official image](https://hub.docker.com/_/postgres).

Compose dễ lưu cấu hình và tái hiện hơn cài Redis rời trong một distro chưa có. Redis trực tiếp trong WSL Ubuntu là phương án dự phòng nếu Docker không chạy được; cần phê duyệt cài distro/package/systemd và một runbook khác, chưa tự thực hiện. Không đề xuất binary Redis Windows không rõ nguồn.

### 2.2. Bảo mật Redis

`redis.conf` bật protected-mode; default user bị tắt qua ACL. Địa chỉ bind 0.0.0.0 trong file là **bên trong container**, còn publication trên Windows chỉ loopback. Không dùng host network và không chia network Redis với PostgreSQL test.

ACL có hai user tách biệt:

| Redis user | Phạm vi dự thảo |
| --- | --- |
| warehouse_health | Chỉ PING, không quyền key/dữ liệu/admin |
| warehouse_session | Các command cụ thể cho GET/SET/DEL/PEXPIRE/PTTL/INCR, kết nối và Lua session/rate limiter; key chỉ ssw:p3:session:* và ssw:p3:rate:* |
| default | Tắt; không nopass |

Không +@all, ~*, CONFIG, FLUSHDB/FLUSHALL, ACL management, KEYS hoặc SCAN. ACL adapter còn phải đối chiếu command thực tế khi chọn Redis client/session implementation; không tự nới quyền khi gặp NOPERM. Lua chỉ chứa code server kiểm soát, không nhận script từ HTTP. [Redis ACL documentation](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/).

File `redis-users.acl.example` chỉ có placeholder, không phải hash thật hoặc ACL sẵn chạy. Secrets thực tế tạo riêng sau duyệt trong `infra/phase3/local/` và được ignore; hạn chế NTFS ACL cho tài khoản vận hành, SYSTEM/Administrators khi cần. Compose secrets là file mount, **không phải kho bí mật được mã hóa**. Không commit hoặc chia sẻ ACL hash, password file, session token, .env thật hoặc dump session.

Healthcheck đọc password health từ secret file; không truyền password trong argv, Compose environment hoặc output health. Password của warehouse_session phải khác password health và PostgreSQL. Backend tương lai lấy credentials từ cấu hình bảo vệ, không từ frontend. Không có secret thật được tạo trong bước này.

### 2.3. Persistence đề nghị: session mất khi Redis restart

Đề nghị mặc định cho demo session-only: `save ""`, `appendonly no`, tmpfs /data, không volume Redis lâu dài. Redis restart → mọi phiên/counter cũ mất → người dùng đăng nhập lại. Nghiệp vụ đã commit và idempotency nằm ở PostgreSQL nên không mất theo session. Redis không chứa tồn kho hoặc nguồn dữ liệu giao dịch chính.

Lợi ích: tránh lưu session ra đĩa và tránh khôi phục phiên đã logout từ một snapshot cũ. Đổi lại, không giữ đăng nhập qua restart; rate-limit counter cũng reset. Đây là lựa chọn vận hành **cần duyệt riêng**, không phải mặc định persistence đã được chốt trước đó.

Nếu cần giữ phiên qua restart: dùng named volume và AOF everysec theo cấu hình riêng được review. AOF everysec vẫn có cửa sổ mất khoảng một giây thay đổi khi sự cố, kể cả DEL thu hồi phiên; phải đánh giá nguy cơ phiên đã logout xuất hiện lại, TTL tuyệt đối, bảo vệ backup và chính sách invalidation sau phục hồi. Không bật persistence chỉ để claim “ổn định”. [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/).

maxmemory=128mb, noeviction; container memory limit 512 MiB. Hết bộ nhớ phải báo lỗi/fail closed, không âm thầm fallback session RAM. Đây là giá trị khởi điểm chưa đo tải. Redis TCP timeout=0 không phải session idle timeout: session TTL phải do logic backend sau này tính nguyên tử `min(now+30 phút, issued_at+8 giờ)`.

### 2.4. Health và tự khởi động lại

Compose đặt healthcheck PING có xác thực, interval 10 giây, timeout 3 giây, retries 5. Health PONG chỉ chứng minh Redis tiếp nhận lệnh health; không chứng minh ACL session, TTL hoặc Auth API đã đúng.

`restart: unless-stopped` xử lý process/container thoát và Docker daemon khởi động lại. Nó không tự mở Docker Desktop trên Windows, không tự restart container chỉ vì bị đánh dấu unhealthy, và không khởi động lại container đã dừng chủ động. Chủ dự án có thể bật “Start Docker Desktop when you sign in” sau duyệt; demo cần đăng nhập Windows và Docker engine thực sự lên. Không hứa tự chạy trước khi Windows login. [Docker restart policy](https://docs.docker.com/engine/containers/start-containers-automatically/).

## 3. PostgreSQL chính và tài khoản thử nghiệm

Kết nối `warehouse_readonly` tới smart_warehouse: preflight giai đoạn 2 PASS; SELECT năm bảng nghiệp vụ; không SELECT bất kỳ cột users, không DML sáu bảng, không membership quản trị. Fingerprint dữ liệu/schema/function vẫn khớp baseline trước chuẩn bị.

Metadata users: PK bigint identity; username UNIQUE varchar(50); role CHECK ADMIN/KEEPER/STAFF/VIEWER; password_hash text **nullable, không default/check thuật toán**; is_active boolean. Không có bằng chứng về account/password cụ thể vì role hiện tại không được đọc users. Không thử vượt quyền, đoán mật khẩu hay dùng tài khoản quản trị runtime.

Trong cluster chính hiện **không thấy database smart_warehouse_phase3_test**, warehouse_backend hoặc warehouse_stock_executor qua catalog. record_stock_movement còn INVOKER, owner postgres, không function search_path riêng, EXECUTE qua PUBLIC; chưa áp hardening.

DBA chạy `01-inspect-test-account-readonly.psql` bằng session đã có quyền, với username thử nghiệm được chỉ định. Script chỉ trả boolean account_exists/active/hash_null/hash_blank/algorithm marker/allowed_role. Không trả username, role cụ thể, password hoặc hash. Marker không chứng minh verifier parse được hoặc password đúng. Chưa có username được chỉ định và chưa có kết quả DBA, nên **tài khoản thử nghiệm chưa được xác nhận khả dụng**.

Nếu hash thiếu/không hợp lệ: đề nghị một tác vụ thiết lập riêng trên DB test sau phê duyệt, dùng thư viện Argon2id đã chọn để sinh hash trong bộ nhớ rồi UPDATE bằng parameters; mật khẩu nhập kín/sinh ngẫu nhiên và chuyển qua kênh riêng, không ghi ra log, SQL file, README hoặc argv. Không đặt mật khẩu mặc định, không tự reset tài khoản hiện có, không sao chép hash từ DB chính. Phê duyệt này chưa bao gồm thao tác thay password. [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Phân biệt hai loại: mật khẩu PostgreSQL của role kết nối và password_hash trong users của người đăng nhập ứng dụng. Provision một loại không làm loại còn lại sẵn sàng.

## 4. Database test và fixtures

Chọn cluster/container riêng là đề xuất thêm cần duyệt: PostgreSQL role dùng chung toàn cluster, không riêng từng database. Tạo hai role trong cluster chính dù GRANT chỉ trên DB test vẫn là thay đổi cluster chính. Script bootstrap vì vậy từ chối cluster có database smart_warehouse. [PostgreSQL database roles](https://www.postgresql.org/docs/17/database-roles.html).

Tạo test DB từ template0, **không clone data**, không pg_dumpall và không dump users. Dựng sáu bảng, CHECK/FK/index/identity/generated từ metadata đã kiểm; có trigger tạo inventory. PostgreSQL test giữ major 17, ưu tiên đúng patch 17.11. Windows và Linux có thể khác locale/collation; sau khởi tạo cần ghi nhận version/collation/timezone và kiểm hành vi tìm kiếm thực tế, không coi hai server giống tuyệt đối chỉ vì cùng version.

Fixtures dự kiến, chưa INSERT:

- Sáu user tổng hợp: ADMIN/KEEPER/STAFF/VIEWER active, một KEEPER inactive, một VIEWER nohash. **Tất cả hash=NULL**; cố ý chưa dùng được để login. Provision hash test hợp lệ là bước riêng cần duyệt.
- P3_A/P3_B tồn 100, mỗi sản phẩm có item factor=1 và box factor=10; hai mã quét/đơn vị độc lập.
- Sản phẩm inactive, sản phẩm thiếu inventory có chủ ý, sản phẩm tồn bigint tối đa để kiểm overflow.
- P3_GATE_A/P3_GATE_B active và một điểm quét inactive.
- Một giao dịch legacy **tổng hợp** của P3_A để kiểm request_scan_code vẫn NULL sau migration; không lấy giao dịch lịch sử từ DB chính.

Fixture script chỉ chạy một lần khi các bảng còn rỗng; không ON CONFLICT overwrite/reset. Các ca KT2/concurrency sau này cần fixture/baseline riêng hoặc database test được khôi phục có kiểm soát giữa ca; kiểm count delta so baseline, không giả định bảng luôn rỗng. Mọi DELETE có chủ ý trong fixture chỉ tạo ca thiếu inventory ở cluster test, không có quyền DELETE ở runtime.

## 5. Danh sách artifact để review

| Artifact | Phạm vi nếu được chạy sau duyệt |
| --- | --- |
| scripts/phase3/00-inspect-main-readonly.sql | Catalog main/test, chỉ đọc; không đọc users rows |
| scripts/phase3/01-inspect-test-account-readonly.psql | Metadata boolean của một account do DBA chỉ định; READ ONLY, cần quyền sẵn có |
| scripts/phase3/guard-test.psql | Chốt DB/cluster/operator/PG17/marker; không phải migration |
| scripts/phase3/10-bootstrap-isolated-cluster.psql | Cluster test mới: CREATE DB và ba role; không password, chưa LOGIN; PUBLIC CONNECT/TEMP trên DB test bị thu hồi |
| scripts/phase3/20-create-test-schema.psql | Tạo đúng sáu bảng, constraint/index/trigger helper; không sửa schema đang có |
| scripts/phase3/21-reference-function.psql | Cài bản baseline function để đối chiếu; từ chối nếu function/cột migration đã có; không dùng làm rollback |
| scripts/phase3/30-test-fixtures.psql | Ghi dữ liệu tổng hợp vào test; không password/hash hợp lệ |
| scripts/phase3/40-hardening-test.psql | Thêm cột nullable, body RBAC/idempotency B, owner/path/ACL; owner đổi trước DEFINER, một transaction |
| scripts/phase3/50-verify-hardening-readonly.psql | Catalog quyền hiệu lực từng cột/bảng/sequence/role/function, không gọi nghiệp vụ |
| scripts/phase3/90-disable-writes-test.psql | Thu hồi EXECUTE, NOLOGIN backend test; giữ dữ liệu/cột/hardening |
| infra/phase3/compose.review.yaml, redis.conf | Hạ tầng dự thảo; không có auto-init SQL; chưa up/pull |
| infra/phase3/.env.example, redis-users.acl.example, .gitignore | Placeholder và ignore local secrets; không chứa bí mật thật |
| docs/PHASE3_SQL_DIFF.patch | Unified diff giữa reference function script và migration/hardening script; tài liệu review, không chạy bằng psql |

`.psql` cần psql với ON_ERROR_STOP; có meta-command `\ir`, không dán nguyên file vào pgAdmin. Mở **toàn bộ file**, không chạy riêng đoạn ALTER/GRANT bỏ guard. Chưa thêm lệnh npm tự chạy DDL/GRANT; chưa sửa package/dependencies/.env/src/test/integration.

## 6. Bảo toàn giai đoạn 1–2

- Đã chạy lại `npm.cmd test`: **36/36 PASS**, không xóa/sửa test để đạt kết quả này.
- Preflight DB thật bằng reader PASS; snapshot năm bảng + metadata sáu bảng + checksum function khớp baseline giai đoạn 2. Không đọc dữ liệu users.
- Integration **10/10 là baseline đã lưu trước bước chuẩn bị**, chưa chạy lại toàn suite trong bước này; không ghi đè báo cáo phase2-verification.json chỉ để cập nhật timestamp.
- Source/API hiện tại chưa thay đổi. Sau khi auth được duyệt triển khai, giữ assertions cũ về dữ liệu/SQL/projection/error/pagination và thêm fixture phiên cho sáu GET được bảo vệ; không xóa kiểm tra quyền hoặc phép audit chỉ đọc.
- Unit test không chứng minh hardening SQL hoặc Redis chạy được. KT1–KT3/concurrency chưa chạy; migration chưa được SQL engine test thực thi vì DB test chưa được tạo.
- `docker compose -f infra/phase3/compose.review.yaml config --no-interpolate --no-env-resolution --quiet` đã exit 0: cấu trúc Compose hợp lệ ở mức kiểm tĩnh. Không nội suy biến/secrets, không kiểm chứng digest/image/ACL/startup. Cảnh báo quyền đọc Docker config trong sandbox không làm bước kiểm tĩnh này thất bại.
- Đã chạy script catalog 00 trong READ ONLY thành công; so lại snapshot chính và body reference khớp baseline. Kiểm tĩnh guard, thứ tự owner trước DEFINER, liên kết tài liệu và SQL diff đạt yêu cầu kiểm tra; **không thay thế parse/execute migration trên PostgreSQL test**.

## 7. Checklist thủ công sau khi duyệt thay đổi cụ thể

Các bước dưới là runbook tương lai, **chưa thực hiện**:

1. Duyệt container PostgreSQL riêng, Redis không persistence cho demo, digest image và artifact SQL. Nếu cần AOF hoặc cùng cluster chính, phải review thiết kế khác trước.
2. Mở Docker Desktop, dùng Linux containers/WSL2; xác minh docker info và docker ps thực sự kết nối. Không tự cài/nâng Docker/WSL khi chưa cần và chưa duyệt.
3. Xác nhận port 6379/5433 trống ngay trước start. Chọn/pull image sau duyệt network/download; lưu tag+digest đã kiểm, thay placeholder trong file cấu hình local được ignore.
4. Tạo local secrets riêng bằng trình nhập kín/secret manager, hash ACL bằng SHA-256 trong bộ nhớ, không in giá trị; đặt NTFS ACL hạn chế. Không dùng ACL example nguyên trạng và không dùng lại mật khẩu DB chính.
5. Validate Compose với file env local; `config --quiet` không in cấu hình đã nội suy secrets. Bật stack sau duyệt; không mount SQL vào docker-entrypoint-initdb.d.
6. Redis: xác nhận bind host loopback; PING có auth thành PONG; không auth nhận NOAUTH, password sai bị từ chối; health user không GET/SET; session user không truy cập prefix khác hoặc CONFIG/FLUSH*/ACL. Chỉ dùng key tổng hợp cho test ghi sau duyệt.
7. Test TTL/expiry và session-store error trong giai đoạn triển khai sau; kiểm restart Redis mất key theo cấu hình, không ảnh hưởng PG; engine restart tự hồi container trừ trường hợp chủ động stop. Unhealthy cần chẩn đoán, không tự coi đã tự phục hồi.
8. Kết nối admin **127.0.0.1:5433, database postgres**, không dùng cấu hình .env chính; psql 17.11 có sẵn, dùng `-X -W -v ON_ERROR_STOP=1`. Không đặt password trong argv hoặc URL.
9. Sau duyệt SQL: chạy 10 với `-v phase3_approval=approved-isolated-phase3`; reconnect vào smart_warehouse_phase3_test rồi lần lượt 20→21→30→40→50. Không chạy mọi file glob vì 90 là containment, không phải bước cài đặt.
10. Xem đủ các bảng kết quả 50: đúng column privileges, không PUBLIC/reader EXECUTE, owner tối thiểu, runtime không DML/membership/CREATE/TEMP/sequence. Đây chưa phải test login vì bootstrap giữ các role NOLOGIN.
11. Phê duyệt riêng việc cấp credential cho **hai role runtime mới ở cluster test**; dùng giao diện kín hoặc psql `\password`, review cấu hình logging credential trước khi thao tác; bật LOGIN sau đó. Không đổi password role/main hiện có. NOLOGIN của executor giữ nguyên.
12. DBA cung cấp boolean metadata account; phê duyệt provision hash cho các user tổng hợp nếu cần. Chưa có hash hợp lệ thì không đánh dấu auth integration sẵn sàng.
13. Kiểm kết nối thật bằng reader/backend test, chứng minh quyền phủ định trên test; sau đó mới xem xét triển khai Auth/RBAC/Session/POST và chạy KT1–KT3/concurrency với ít nhất hai connection độc lập.
14. Giữ volume PG test qua restart; không xóa volume/reset để che lỗi. Khi có lỗi bootstrap/DDL, giữ log an toàn và kiểm trạng thái trước, không lặp CREATE/DROP tự động.

## 8. Quyết định cần phê duyệt riêng và trạng thái sẵn sàng

| Quyết định | Đề nghị cụ thể |
| --- | --- |
| Môi trường test | Container PostgreSQL 17.11 riêng ở 5433, không tạo role/database trong cluster chính |
| Redis lifecycle | Docker Compose hiện có; session-only không persistence, restart bắt buộc đăng nhập lại; unless-stopped và Desktop start-on-login tùy chọn |
| Image/resources | Duyệt digest sau pull/inspect và ngân sách RAM; chưa có digest được xác minh trên máy |
| SQL được phép chạy | 10/20/21/30/40 sau review diff; 50 kiểm quyền; 90 chỉ containment khi có lý do |
| Credentials/hash test | Tác vụ tạo credential runtime và provision Argon2id riêng; không áp cho tài khoản chính |
| Database chính | **Chưa được phép áp thay đổi**. Cần bộ guard/main rollout riêng, backup metadata/ACL, kiểm người dùng hàm và phê duyệt diff trên catalog mới nhất |

Kết luận sẵn sàng hiện tại: **Docker/WSL đã cài; Docker engine chưa hoạt động; Redis chưa sẵn sàng; DB test chưa tồn tại; account ứng dụng chưa xác minh; SQL là bản review chưa thực thi**. Bước tiếp theo được đề nghị là duyệt hạ tầng test và scripts cụ thể, chưa phải triển khai API.
