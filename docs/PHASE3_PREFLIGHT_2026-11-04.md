# Giai đoạn 3 — Kiểm tra trước thực thi ngày 04/11/2026

Múi giờ Asia/Bangkok. Đã duyệt kiến trúc Docker riêng cho Redis và PostgreSQL test, Redis không persistence. **Chưa được xác nhận bước pull/up hoặc thực thi SQL**. Báo cáo này cập nhật trạng thái môi trường ngày 03/11; không được dùng trạng thái Docker cũ để kết luận hiện tại.

Đã thực hiện: lệnh kiểm tra Docker, RAM, listener/TCP, Compose config, đọc manifest registry và rà soát file. Không pull layer, tạo/start container, tạo secret/password/hash hoặc kết nối/thay đổi database trong lượt kiểm tra này. Script SQL và cấu hình hiện hành được giữ nguyên; chỉ có tài liệu mới, patch đề xuất và đính chính tài liệu về REVOKE.

## 1. Trạng thái và bằng chứng

| Kiểm tra | Kết quả | Phạm vi kết luận |
| --- | --- | --- |
| docker info | **PASS** | Engine 29.4.2 phản hồi; linux/x86_64, 12 CPU; RAM nhìn thấy 8,173,740,032 byte ≈7.61 GiB |
| docker ps | **PASS** | Lệnh chạy thành công, không có container đang chạy tại thời điểm kiểm tra; không kết luận mọi image/container đã bị xóa |
| docker compose version | **PASS** | v5.1.3 |
| Port 5433 và 6379 | **PASS — trống lúc kiểm tra** | Không có listener qua Get-NetTCPConnection; TCP loopback đều ECONNREFUSED. Phải kiểm lại ngay trước start |
| Compose không nội suy | **PASS — kiểm tĩnh** | config --no-interpolate --no-env-resolution --quiet exit 0 |
| Compose với .env.example | **PASS — dựng model** | config --format json exit 0; chỉ xuất tóm tắt không có secret |
| Cấu hình để chạy thật | **CHƯA ĐẠT** | Hai image reference vẫn chứa REPLACE_WITH_APPROVED_DIGEST; ba file secret đều chưa tồn tại |
| Tag/digest registry | **PASS — manifest metadata** | Hai tag tồn tại và có linux/amd64; chi tiết ở mục 2. Chưa pull/chạy binary image hoặc quét lỗ hổng |
| Giới hạn tài nguyên | **PASS — khai báo** | Redis 512 MiB, PostgreSQL 768 MiB; mỗi service 1 CPU. Chưa kiểm hiệu lực trên container |
| RAM khả dụng Windows | **CHƯA KẾT LUẬN ĐỦ** | Máy có ≈15.71 GiB RAM vật lý; FreePhysicalMemory chỉ 317,332 KiB ≈310 MiB tại lần đo |
| Redis PING/ACL | **CHƯA CHẠY** | Chưa service/secret; không có bằng chứng PONG hay quyền runtime |
| PostgreSQL test | **CHƯA CHẠY** | Chưa listener ở 5433; không có kết nối test hoặc SQL test |
| SQL 10–90 | **ĐÃ REVIEW TĨNH; CHƯA THỰC THI** | Không đánh dấu migration/ACL/function PASS ở runtime |
| Git ignore | **ĐÃ REVIEW QUY TẮC; CHƯA KIỂM TRACKING** | Có local/ trong infra/phase3/.gitignore; workspace hiện không nằm trong Git repository |

Sandbox ban đầu từ chối Docker API; đã kiểm tra lại các lệnh đọc ngoài sandbox với quyền được chấp thuận. Không in Docker config, registry credentials hoặc toàn bộ environment.

mem_limit là trần, không phải lượng RAM được đặt trước. Tổng hai trần là 1.25 GiB, nhưng việc Docker báo tổng 7.61 GiB không chứng minh host đang đủ RAM khả dụng. Đề nghị giải phóng tài nguyên trước demo và đo lại; mục tiêu khoảng 2 GiB available là khuyến nghị vận hành cho stack nhỏ này, không phải bảo đảm hiệu năng. Không tự đóng ứng dụng, tăng WSL limit hoặc thay cấu hình máy.

## 2. Image đã xác minh qua registry

Chỉ dùng `docker buildx imagetools inspect`, không pull layer. Đây là lệnh đọc thông tin image trong registry theo [Docker documentation](https://docs.docker.com/reference/cli/docker/buildx/imagetools/inspect/).

| Tag | Index digest |
| --- | --- |
| redis:8.10.3-alpine | sha256:21090af93f8324db2f0f0f4f38a7c60369d47d917e000c3423d89d2ae2883537 |
| postgres:17.11-bookworm | sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5 |

Manifest linux/amd64 tương ứng:

- Redis: sha256:be7c1cada5a6eb1656adfa2635b99296af725881301b21f84f35a71fac072c7f.
- PostgreSQL: sha256:2cd2c0f809604aaeff6f0ec8f40aecbd025613107561015c69369a1a7f1d3416.

Đây là digest image công khai, không phải password hash. Đề xuất pin **index digest** và khai báo platform linux/amd64 phù hợp engine đang dùng. Không tự thay active .env.example/Compose; diff nằm trong [patch đề xuất](PHASE3_PREFLIGHT_FIXES.patch). Sau khi được duyệt, file local dùng các giá trị thật sau:

```dotenv
REDIS_IMAGE=redis@sha256:21090af93f8324db2f0f0f4f38a7c60369d47d917e000c3423d89d2ae2883537
POSTGRES_IMAGE=postgres@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5
REDIS_ACL_FILE=./local/redis-users.acl
REDIS_HEALTH_PASSWORD_FILE=./local/redis-health-password.txt
POSTGRES_ADMIN_PASSWORD_FILE=./local/postgres-admin-password.txt
```

`${VAR:?}` chỉ kiểm tra biến không rỗng, không bảo đảm digest hợp lệ. Vì vậy Compose config exit 0 với placeholder không phải bằng chứng sẵn sàng chạy. Trước up phải kiểm reference có đúng @sha256: + 64 chữ hex, không còn REPLACE/PLACEHOLDER và đúng digest đã review.

## 3. Redis, secrets và ignore

Rà soát cấu hình tĩnh xác nhận:

- Host publish chỉ 127.0.0.1:6379; bind 0.0.0.0 chỉ bên trong container. PostgreSQL publish riêng 127.0.0.1:5433, hai service tách network.
- Redis protected-mode=yes, default user off; health chỉ PING; session user giới hạn hai prefix, không ACL/CONFIG/FLUSH*/KEYS/SCAN/allkeys/allcommands.
- Healthcheck đọc password từ secret file vào REDISCLI_AUTH; không dùng -a, URI chứa password hoặc echo secret. Health user không được cấp GET/SET.
- Redis không RDB/AOF, /data là tmpfs, noeviction, root filesystem read-only; restart dự kiến mất phiên. Chưa kiểm restart thực tế.
- Redis ACL example có placeholder không hợp lệ; không được mount trực tiếp example để chạy. Chưa có local/, ACL thật hoặc password file để đối chiếu.
- Compose chỉ mount secret vào service được khai báo. File secret mount không đồng nghĩa mã hóa hay tự có NTFS ACL an toàn. [Docker Compose secrets](https://docs.docker.com/reference/compose-file/secrets/).

Điều kiện provisioning riêng cần duyệt:

1. Tạo password ngẫu nhiên riêng cho health, session và admin PostgreSQL test; không dùng password DB chính. Chưa thực hiện trong bước này.
2. Password file là UTF-8 không BOM, không CR/LF/NUL hoặc newline cuối. Trên Windows, CRLF/BOM có thể trở thành một phần credential khi shell/entrypoint đọc file và làm xác thực sai. Không copy password qua command line hoặc Terminal.
3. ACL thật phải có hash SHA-256 đúng 64 hex, khớp password health/session tương ứng; kiểm bằng chương trình không in giá trị. Đây là bước chưa kiểm vì file chưa tồn tại. File ACL cấu hình dùng LF/UTF-8 không BOM.
4. Hạn chế NTFS ACL của local/ trước khi ghi secrets; không gửi file/hash qua chat hoặc báo cáo. Redis session password phục vụ backend sau này, chưa có Redis client/API sử dụng ở bước này.
5. Quy tắc ignore local/ đã có; khi dự án có Git, chạy check-ignore và kiểm tra cả index/commit. .gitignore không gỡ secret đã từng được track. Hiện không có Git repository nên chưa chứng minh ignore hiệu lực bằng Git hoặc kiểm lịch sử commit.

## 4. Rà soát toàn bộ chuỗi SQL

Không file nào dưới đây đã chạy trong bước này. Mọi .psql phải chạy nguyên file bằng psql -X với ON_ERROR_STOP, không chọn riêng ALTER/GRANT để bỏ guard.

| File | Dependency và quyền | Điều kiện / giới hạn |
| --- | --- | --- |
| guard-test.psql | Session/current_user postgres; PG17 | Đúng smart_warehouse_phase3_test, marker isolated-test-v1; từ chối cluster có smart_warehouse. Guard không chứng minh host port NAT là 5433 |
| 10-bootstrap-isolated-cluster | Cluster test mới; postgres superuser; kết nối DB postgres; biến phase3_approval đúng | Từ chối DB/ba role đã tồn tại. CREATE DATABASE ngoài transaction; role/ACL/marker trong transaction sau. Có thể để lại DB rỗng nếu phần sau lỗi; không tự rerun/drop |
| 20-create-test-schema | Sau 10, reconnect DB test để nhận marker | Schema phải rỗng. Tạo sáu bảng, constraints/index/identity/generated và trigger helper. Không cần sequence grant runtime |
| 21-reference-function | Sau 20; cần stock_transactions và lookup tables để resolve ROWTYPE/body baseline | Chỉ cài reference khi function và request_scan_code chưa có. INVOKER, chưa harden, không được dùng để downgrade hoặc mở runtime lúc này |
| 30-test-fixtures | Sau 20/21; admin test, users/products/transactions rỗng | Ghi fixture tổng hợp, cố ý DELETE inventory của một test product; hash NULL, không login được. Chạy trước 40 để kiểm legacy row thật sự có trước migration |
| 40-hardening-test | Sau 21 và fixture legacy nếu kiểm migration; operator postgres, đúng checksum baseline; ba role vẫn NOLOGIN/NOINHERIT và không membership | ADD COLUMN + quyền + body + owner + mode + default privileges trong một transaction. Timeout lock 1s, statement 5s. Không backfill, không gọi function |
| 50-verify-hardening-readonly | Sau 40; admin test, READ ONLY | In quyền hiệu lực từng cột/bảng/sequence/function/role. Hiện chưa ném lỗi chỉ vì một boolean policy là false; không dùng exit 0 làm tín hiệu toàn policy PASS |
| 90-disable-writes-test | Chỉ containment sau khi hardening đã có, admin test | REVOKE EXECUTE và backend NOLOGIN; giữ dữ liệu/cột. Không tự hủy giao dịch/kết nối đang chạy, không downgrade body/quyền |

Thứ tự dự kiến sau khi được duyệt **SQL execution riêng**: 10 → reconnect → 20 → 21 → 30 → 40 → 50. File 90 không phải bước cài đặt thường lệ. Không include 50 nguyên trạng trong 40: file 50 có BEGIN READ ONLY và ROLLBACK, sẽ phá ranh giới transaction migration.

### Quyền theo cột, PUBLIC và owner

Đã đối chiếu các cột hàm đang dùng với GRANT dự thảo:

- Executor có SELECT inventory.product_id/quantity_base và UPDATE quantity_base/updated_at, đáp ứng lookup, FOR UPDATE và UPDATE RETURNING.
- ON CONFLICT(transaction_id) và RETURNING transaction_id cần SELECT transaction_id; đã có. SELECT để so replay và UPDATE inventory_after cũng có đúng cột tương ứng. [PostgreSQL 17 INSERT privileges](https://www.postgresql.org/docs/17/sql-insert.html).
- Executor không được SELECT password_hash hoặc UPDATE users; backend chỉ SELECT sáu cột auth và mười cột POST response, không DML; reader giữ SELECT năm bảng, không users.
- Thu hồi PUBLIC EXECUTE trước thay body; body vẫn INVOKER khi owner còn postgres; chuyển owner và kiểm NOLOGIN/không superuser trước ALTER SECURITY DEFINER. search_path cố định pg_catalog, public, pg_temp; mọi bảng nghiệp vụ public.*.
- RLS chưa được thiết kế như một lớp RBAC mới. Backend vẫn là nơi xác thực actor từ Redis session; SQL p_user_id không tự chứng minh danh tính trình duyệt.
- Đính chính nhận định trong tài liệu cũ: PostgreSQL 17 **thu hồi quyền cột tương ứng khi REVOKE quyền bảng**. Không cần thêm REVOKE từng cột chỉ vì nhận định sai đó. Vẫn phải kiểm quyền hiệu lực và membership, ownership, grant option. [PostgreSQL 17 REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html).

Chưa xác nhận bằng thực thi rằng function/ACL hoạt động. Không tìm thấy lỗi thiếu GRANT rõ ràng qua đối chiếu tĩnh hiện tại; không coi điều này là SQL-engine validation hoặc concurrency test PASS.

## 5. Bản sửa đề xuất và ảnh hưởng — chưa áp dụng

[PHASE3_PREFLIGHT_FIXES.patch](PHASE3_PREFLIGHT_FIXES.patch) là diff review, không phải lệnh được phép chạy ngay.

| Đề xuất | Ảnh hưởng |
| --- | --- |
| Thay hai placeholder image bằng index digest đã xác minh; thêm platform linux/amd64 | Tái hiện image đúng nền tảng, không thay port/RAM/secret; chỉnh file không tự pull hoặc start |
| Thêm assert-hardening.psql chỉ đọc catalog, không BEGIN/COMMIT/ROLLBACK | Tái sử dụng kiểm owner/path/EXECUTE/PUBLIC/membership/schema/database/sequence và 108 tổ hợp role–cột của baseline sáu bảng/36 cột |
| Include assertion trước COMMIT của 40 | Nếu policy không khớp, migration bị abort/rollback; không có cửa sổ đã COMMIT rồi mới thấy mismatch từ script 50. Không mở thêm quyền hoặc sửa dữ liệu |
| Include assertion trong 50 trước ROLLBACK | Mismatch trở thành SQL error/nonzero psql exit thay vì chỉ có boolean false. Nhãn HARDENING_METADATA_PASS chỉ xuất sau assertion; không đồng nghĩa Auth/Redis/concurrency đã PASS |

Chốt assertion bổ sung là đề nghị tăng khả năng phát hiện sai policy, không phải kết luận các GRANT hiện tại đã sai khi chạy trên baseline sạch. Assertion dựa trên baseline cố định nên thay schema sau này phải được review cùng assertion. SQL trong patch chưa được PostgreSQL test parse/thực thi; cần duyệt rồi kiểm thực tế trong môi trường test, không main.

Chỉ sửa tài liệu để đính chính REVOKE ngay trong lần review; **không áp patch lên SQL hoặc Compose/.env.example**, không tạo file assertion active. Các script/config active được so checksum trước/sau tạo patch và không đổi.

## 6. Lệnh tiếp theo và chốt trước thực thi

### Hiện tại: chỉ kiểm đọc

```powershell
Set-Location D:\Project_CNNT
docker info --format 'Server={{.ServerVersion}} OS={{.OSType}} RAM={{.MemTotal}}'
docker ps
docker compose version
docker compose -f infra/phase3/compose.review.yaml config --no-interpolate --no-env-resolution --quiet
Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory
```

Bước cần xác nhận trước: duyệt patch config/assertion, giải phóng/đo lại RAM, và cho phép provisioning secrets kín. Không cần cài lại Docker/WSL. Không chạy up hoặc pull khi file local chưa được chuẩn bị và vẫn còn placeholder.

### Chỉ sau khi xác nhận bước thực thi hạ tầng và đã chuẩn bị secrets

Các lệnh này **chưa chạy** và không bao gồm migration/fixtures:

```powershell
docker compose --env-file infra/phase3/local/compose.env -f infra/phase3/compose.review.yaml config --quiet
docker compose --env-file infra/phase3/local/compose.env -f infra/phase3/compose.review.yaml pull redis postgres-test
docker compose --env-file infra/phase3/local/compose.env -f infra/phase3/compose.review.yaml up -d --no-build --pull never redis postgres-test
docker compose --env-file infra/phase3/local/compose.env -f infra/phase3/compose.review.yaml ps
```

config --quiet cần exit 0 nhưng vẫn phải kiểm digest/prefix/secret presence/encoding/ACL riêng, vì Compose không thay thế các kiểm tra đó. Không in config đầy đủ hoặc docker inspect toàn bộ environment. Sau pull phải kiểm RepoDigests/platform khớp registry đã review, không chỉ tên tag.

PING bằng tài khoản health, không truyền password trong argv hoặc Terminal:

```powershell
docker compose --env-file infra/phase3/local/compose.env -f infra/phase3/compose.review.yaml exec -T redis sh -c 'REDISCLI_AUTH="$(cat /run/secrets/redis_health_password)" redis-cli --user warehouse_health --no-auth-warning ping'
```

Chỉ đánh dấu PASS khi thực tế nhận PONG và exit 0. Nếu AUTH/ACL lỗi: kiểm encoding/credential/ACL kín, không dùng -a hoặc tắt xác thực để chữa. PONG bằng health không xác nhận session user hoặc TTL 30 phút/8 giờ; các test đó thuộc bước triển khai được duyệt riêng.

### Checklist PostgreSQL không nhầm cổng 5432

1. `docker compose ... port postgres-test 5432` phải trả **127.0.0.1:5433**. Container port là 5432; Windows host port mới là 5433.
2. Lần kết nối đầu dùng database **postgres**, vì smart_warehouse_phase3_test chỉ được tạo khi script 10 được duyệt thực thi sau này. Không dùng .env chính và không mong target DB đã có chỉ vì container healthy.
3. Dùng psql rõ host/port, bỏ .psqlrc, hỏi password kín:

```powershell
docker compose --env-file infra/phase3/local/compose.env -f infra/phase3/compose.review.yaml port postgres-test 5432
& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -X -W -h 127.0.0.1 -p 5433 -U postgres -d postgres -c '\conninfo' -c 'SELECT current_database(),current_user,current_setting(''server_version'') AS version,inet_server_port() AS port_inside_container; SELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=''smart_warehouse'') AS isolated_cluster;'
```

4. conninfo phải cho thấy client kết nối 127.0.0.1:5433; SQL inet_server_port() **dự kiến 5432 trong container**, không phải dấu hiệu nhầm main. isolated_cluster phải true. pg_isready chỉ là readiness probe, không chứng minh password/schema/ACL.
5. Dừng trước mọi DDL/GRANT/fixture; ghi lại kết quả connection check an toàn rồi xin duyệt bước SQL riêng. Sau khi 10 thực sự được phép chạy, reconnect DB test và kiểm marker trước 20–50; không tự đổi main để vượt guard.

Kết luận: Docker/Compose đã hoạt động, ports hiện trống, manifest đã xác minh. Stack **chưa sẵn sàng thực thi** vì cấu hình active còn placeholder, secrets chưa có, RAM cần kiểm lại và chưa có PONG/kết nối PostgreSQL test. Chưa thực hiện bước tải/chạy container hoặc thay đổi database.
