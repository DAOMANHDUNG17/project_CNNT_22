# Giai đoạn 3 — SQL diff, quyền hiệu lực và rollback

Trạng thái: **bản review chưa áp dụng**, cho môi trường test độc lập. Kiến trúc đã được phê duyệt có điều kiện; phê duyệt này không cho phép chạy SQL trên smart_warehouse chính.

## 1. Các thay đổi DB cần review

| Đối tượng | Hiện tại trên DB chính | Đề xuất; chỉ áp trên test sau duyệt |
| --- | --- | --- |
| Bảng | Sáu bảng, dữ liệu hiện có | Vẫn sáu bảng; test dùng dữ liệu tổng hợp, không clone users/giao dịch |
| stock_transactions | Chưa request_scan_code | ADD COLUMN request_scan_code varchar(80), nullable, không default, không backfill |
| Role | warehouse_readonly hiện có; chưa backend/executor | Cluster test mới tạo reader riêng, backend riêng và executor NOLOGIN; không sửa role chính |
| Function signature/result | Sáu tham số; TABLE(result_status text,current_inventory bigint) | Giữ chữ ký/kiểu trả để hạn chế phá tương thích; DUPLICATE vẫn trả snapshot cũ |
| Function RBAC | ADMIN/KEEPER/STAFF đều IN+OUT | STAFF chỉ OUT; VIEWER không ghi |
| Replay | Kiểm catalog/khóa tồn trước duplicate; so semantic unit | Khóa UUID, kiểm actor/quyền, so input gốc đã lưu trước catalog; legacy NULL bị từ chối replay |
| Owner/mode | postgres / INVOKER | executor tối thiểu / DEFINER; **owner đổi và được kiểm trước khi bật DEFINER** |
| Search path | Không function config, tên bảng/type chưa qualified | pg_catalog, public, pg_temp cố định; bảng public.*; dùng record với projection rõ ràng |
| EXECUTE | PUBLIC và owner | Chỉ owner implicit và backend được allowlist; reader/PUBLIC không có |
| DML runtime | Reader không DML | Reader/backend đều không DML; executor chỉ INSERT lịch sử/UPDATE tồn và snapshot cần thiết |
| Errors | Nhiều lỗi chung P0001 | PZ001–PZ011; backend sau này mapping allowlist; không gửi SQL detail ra HTTP |
| Metadata concurrency | Đọc role/active/factor không khóa | Giữ policy kiểm tại thời điểm đọc, request đã qua kiểm có thể hoàn thành; không thêm UPDATE users để lấy row lock |

[Unified SQL diff](PHASE3_SQL_DIFF.patch) so sánh `21-reference-function.psql` với `40-hardening-test.psql`: gồm thay body, migration, GRANT/REVOKE và bước owner→DEFINER. Phần tạo role/database nằm riêng trong 10; cấu trúc sáu bảng trong 20; fixtures trong 30. Đây không phải schema diff sinh từ một DB test đã tồn tại, và file .patch không phải SQL để Execute.

Reference 21 giữ phần thân baseline đúng định nghĩa đọc từ catalog chính, checksum `59d25e310aaa5acf12ae7823f154725f`; thêm guard và dấu kết thúc statement cho psql. Không dùng reference để ghi đè function sau hardening; script từ chối khi function đã có. Không có password/hash người dùng trong reference/diff.

## 2. Ma trận quyền PostgreSQL sau hardening test

| Quyền hiệu lực | warehouse_readonly | warehouse_backend | warehouse_stock_executor |
| --- | --- | --- | --- |
| LOGIN lúc bootstrap | Không; chờ cấp credential test riêng | Không; chờ cấp credential test riêng | Luôn NOLOGIN |
| CONNECT test DB | Có quyền; LOGIN vẫn chưa bật | Có quyền; LOGIN vẫn chưa bật | Không cấp, không cần đăng nhập |
| USAGE public | Có | Có | Có |
| SELECT products/product_units/inventory/scan_points | Toàn bộ cột, giữ API đọc | Không cần; GET dùng reader pool | Chỉ cột lookup/khóa tồn cần thiết |
| SELECT stock_transactions | Toàn bộ cột hiện có; API vẫn projection không actor/mã request | Chỉ 10 cột POST response, không user_id/request_scan_code | 7 cột so sánh replay/RETURNING |
| SELECT users | Không cột nào | user_id,username,display_name,role,password_hash,is_active | user_id,role,is_active; không password_hash |
| INSERT stock_transactions | Không | Không | 10 cột input/snapshot; không gán generated/time |
| UPDATE inventory | Không | Không | quantity_base,updated_at |
| UPDATE stock_transactions | Không | Không | inventory_after |
| Ghi users/products/units/scan_points | Không | Không | Không |
| DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN | Không | Không | Không |
| Sequence USAGE/SELECT/UPDATE | Không | Không | Không; không tạo user/unit |
| EXECUTE record_stock_movement | Không, kể cả chuyển transaction sang RW | Có | Quyền owner |
| CREATE database/schema/TEMP | Không | Không | Không |
| Membership/grant option/superuser/BYPASSRLS | Không | Không | Không |
| Ownership bảng | Không | Không | Không; owner bảng test là postgres |

Chi tiết cột executor:

- users: SELECT(user_id,role,is_active).
- products: SELECT(product_id,is_active).
- product_units: SELECT(product_id,product_unit_id,scan_code,conversion_factor).
- scan_points: SELECT(scan_point_id,is_active).
- inventory: SELECT(product_id,quantity_base), UPDATE(quantity_base,updated_at). UPDATE quantity_base đồng thời đáp ứng yêu cầu ACL cho SELECT FOR UPDATE.
- stock_transactions: SELECT(transaction_id,user_id,scan_point_id,movement_type,quantity_packages,request_scan_code,inventory_after); INSERT(transaction_id,product_id,product_unit_id,scan_point_id,user_id,movement_type,quantity_packages,conversion_factor_snapshot,inventory_after,request_scan_code); UPDATE(inventory_after).

Chỉ backend có quyền đọc **các cột credential** phục vụ verifier. Executor vẫn cần đọc ba cột identity/RBAC để kiểm nghiệp vụ; không thể hiểu “chỉ backend đọc users” là cấm executor đọc role/active. postgres quản trị luôn có quyền vượt ACL; không dùng role đó trong backend.

SELECT theo cột không hạn chế số hàng: backend credential bị lộ vẫn có thể đọc hash nhiều user. Giảm thiểu bằng tách pool/credential, projection, không endpoint SQL tùy ý, secret/log hygiene và có thể chuyển auth lookup sang function riêng sau review; thiết kế hiện tại không tuyên bố chống được backend compromise. p_user_id được backend lấy từ phiên; DB function không tự kiểm chứng session Redis.

## 3. Thứ tự hardening không có DEFINER owner postgres

Trong một transaction quản trị, có lock_timeout và statement_timeout:

1. Guard: đúng tên DB test, cluster không có smart_warehouse, session/current_user postgres, PG17, marker môi trường; kiểm baseline function/role/table ownership.
2. Thêm cột nullable; thu hồi EXECUTE PUBLIC/reader/backend trước mở đường ghi.
3. Cấp quyền bảng/cột tối thiểu; thay body/path nhưng **vẫn SECURITY INVOKER**.
4. ALTER FUNCTION OWNER TO warehouse_stock_executor.
5. Kiểm owner đúng, NOLOGIN, không superuser/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS và function vẫn INVOKER.
6. Mới ALTER FUNCTION SECURITY DEFINER; GRANT EXECUTE đúng backend; đặt default function EXECUTE của DDL creator postgres trong DB test.
7. Postcheck function path/owner/mode/ACL và điều kiện bảo mật cơ bản trước COMMIT. Nếu sai, ném lỗi; psql ON_ERROR_STOP, session lỗi phải rollback/đóng, không gửi COMMIT thủ công.

50 kiểm **quyền hiệu lực** từng cột, quyền bảng ngoài nghiệp vụ, sequence, schema/database, membership, owner, function config và PUBLIC ACL. Không chỉ kiểm proacl trực tiếp vì quyền có thể qua PUBLIC/membership. Chưa có kết quả thực thi 50; không tự in PASS tổng khi chưa đánh giá đủ các bảng kết quả.

Các nguyên tắc mode/path/PUBLIC EXECUTE được đối chiếu [PostgreSQL 17 CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html); tham khảo [quyền PostgreSQL](https://www.postgresql.org/docs/17/ddl-priv.html).

## 4. Rủi ro và điều kiện kiểm chứng

| Rủi ro | Hàng rào / việc cần làm |
| --- | --- |
| Chạy nhầm host/DB | Cluster riêng cổng 5433, DB marker, guard từ chối cluster có main, psql không dùng .env chính. Guard là phòng lỗi thao tác, không bảo vệ trước quản trị viên chủ động sửa script |
| Role global hoặc PUBLIC GRANT tác động main | Không bootstrap trong cluster chính. Review riêng mọi role/ACL main nếu sau này rollout |
| Quyền hiệu lực ngoài policy | Đính chính ngày 04/11/2026: PostgreSQL 17 REVOKE quyền bảng đồng thời thu hồi quyền cột tương ứng; nhận định trước đây rằng quyền cột luôn còn lại là sai. Vẫn kiểm từng cột và nguồn PUBLIC/membership, không suy ra an toàn chỉ từ một dòng ACL. Xem [PostgreSQL 17 REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html) |
| Rerun overwrite | 10 yêu cầu cluster fresh; 20/30 yêu cầu trạng thái rỗng; 21 từ chối function đang có; 40 yêu cầu checksum baseline và ADD COLUMN không IF NOT EXISTS |
| Không nguyên tử CREATE DATABASE | 10 CREATE DATABASE ngoài transaction; phần tạo role/quyền có transaction riêng. Lỗi sau CREATE có thể để DB rỗng; giữ trạng thái và review thủ công, không tự DROP để chạy lại |
| ALTER TABLE cần khóa | ADD COLUMN nullable không backfill vẫn cần khóa DDL; timeout ngắn, cửa sổ bảo trì, rollback nếu khóa không lấy được |
| Cùng UUID/khác sản phẩm | Advisory transaction lock theo UUID + PK/ON CONFLICT; kiểm C6 bằng hai connection thực sự. Hash collision chỉ thêm chờ, không đổi equality UUID |
| Deadlock/lock timeout | Thứ tự UUID trước inventory; READ COMMITTED, retry cả transaction có giới hạn. Không retry bằng UUID mới |
| COMMIT không rõ/response mất | Replay cùng UUID; không gọi timeout là rollback; lỗi chưa rõ phải có trạng thái riêng |
| Catalog/role đổi khi đang chờ | Chưa khóa users/catalog; có thể hoàn tất request đã được kiểm. Không có API sửa catalog trong bước này, DBA cần maintenance có phối hợp |
| Legacy/request code NULL | Giữ nguyên; POST replay legacy trả lỗi riêng, GET không đổi. Runtime không INSERT trực tiếp nên giao dịch mới qua hàm luôn ghi mã gốc |
| Auth hash chưa khả dụng | Fixtures NULL chỉ phục vụ lookup/RBAC DB; không claim login test PASS. Provision riêng sau phê duyệt |
| Giả nhãn điểm quét | scan_point_id hiện là input nghiệp vụ được kiểm tồn tại/active, chưa phải xác thực thiết bị. Nếu cần chứng minh nguồn máy quét vật lý, phải bổ sung device credential/binding server trong một phạm vi riêng |
| Redis chưa chạy | Compose config chỉ được kiểm tĩnh; chưa PONG/auth/ACL/TTL/restart thật. Không fallback bỏ xác thực |
| Hết RAM/Redis restart | noeviction và session-only không persistence; client đăng nhập lại, limiter counter reset. PG transactions không bị reset theo Redis |
| Thu hồi quyền giữa giao dịch | REVOKE/NOLOGIN không chứng minh request đang chạy đã bị hủy; drain trước bảo trì, xử lý trạng thái COMMIT chưa rõ bằng UUID |

### SQLSTATE đề xuất, chưa có HTTP implementation

| SQLSTATE | Ý nghĩa cho mapping sau này |
| --- | --- |
| PZ001 | INVALID_BODY/input trực tiếp DB sai |
| PZ002 | Actor không hợp lệ/inactive |
| PZ003 | FORBIDDEN theo role và hướng |
| PZ004 | IDEMPOTENCY_CONFLICT |
| PZ005 | IDEMPOTENCY_LEGACY_RECORD |
| PZ006 | INVALID_SCAN_POINT |
| PZ007 | INVALID_SCAN_CODE |
| PZ008 | PRODUCT_INACTIVE |
| PZ009 | INVENTORY_STATE_INVALID |
| PZ010 | INSUFFICIENT_INVENTORY |
| PZ011 | STOCK_LIMIT_EXCEEDED |
| 40001 / 40P01 / 55P03 / 57014 | Theo chính sách retry/timeout đã duyệt; không tiết lộ SQL details |

## 5. Rollback và containment

**Trước COMMIT của 40:** mọi thay đổi cột/function/owner/quyền/default privileges trong file 40 cùng transaction; lỗi phải rollback toàn bộ file 40. Những bước 10/20/21/30 đã commit trước đó không tự rollback theo 40. Khôi phục không được dùng script DELETE/TRUNCATE trên DB chính.

**Sau COMMIT, chưa hoặc đã có giao dịch:** dừng nhận request ghi, xác định/drain request đang chạy; dùng 90 trong DB test để REVOKE EXECUTE backend/PUBLIC/reader và NOLOGIN backend. Giữ owner tối thiểu, path an toàn, request_scan_code, snapshot và dữ liệu đã commit. NOLOGIN không tự ngắt kết nối cũ; REVOKE chỉ kiểm soát lệnh kế tiếp, không đảo ngược nghiệp vụ đã chạy.

Không chuẩn bị tự động DROP COLUMN/DATABASE/ROLE, không restore PUBLIC EXECUTE, không chạy reference 21 như downgrade. Nếu cần phục hồi nguyên trạng schema/function sau khi đã ghi, phải có tác vụ riêng so dữ liệu/phụ thuộc và phê duyệt; không xóa giao dịch để làm rollback code trông sạch. Password đã provision riêng cũng không bị script 90 đổi lại.

Rollback hạ tầng có thể dừng container sau duyệt, giữ volume PostgreSQL. Redis không persistence nên dừng/restart sẽ mất phiên, người dùng đăng nhập lại. Không xóa volume PG test khi chưa có quyết định riêng; không sao chép volume đó đè lên PostgreSQL chính.

## 6. Những thay đổi trên database chính cần duyệt ở bước riêng

Chưa có script chạy main được cho phép. Các file ghi hiện tại **cố ý không thể chạy trong cluster chính**. Nếu sau kiểm thử muốn triển khai lên main, cần diff cụ thể mới với guard main và điều kiện catalog hiện thời:

1. Tạo role backend và owner executor ở cluster chính nếu vẫn chưa tồn tại; review ảnh hưởng toàn cluster, credential provisioning và quyền CONNECT các database khác qua PUBLIC. Giữ reader/password hiện có.
2. ADD COLUMN request_scan_code nullable vào đúng stock_transactions; xác nhận không backfill/UPDATE lịch sử và có kế hoạch khóa/bảo trì.
3. Thu hồi PUBLIC EXECUTE đúng function signature; kiểm callers cũ và tác động trước, không thêm lại PUBLIC để chữa lỗi.
4. Thay body/path, chuyển owner tối thiểu trước bật DEFINER, cấp EXECUTE backend và đúng các quyền cột đã duyệt.
5. Audit quyền hiệu lực, membership, schema CREATE/TEMP, ownership, default privileges và các function dẫn tới ghi. **Không sao chép các lệnh reset ALL TABLES/SCHEMA PUBLIC của môi trường test vào main**; chúng có thể ảnh hưởng dịch vụ khác.
6. Chụp định nghĩa/ACL/metadata và backup phù hợp bằng quy trình quản trị không xuất hash vào artifact công khai; duyệt rollback fail-closed và kết quả test trước áp dụng.

Phê duyệt cần có lúc này: môi trường test/container, lựa chọn persistence Redis, digest và secrets provisioning, các script 10→50 cùng 90, và quy trình credential/hash test. Sau khi những điều kiện này được xác nhận bằng chạy thật, mới đề nghị triển khai Auth/RBAC/Session/POST theo kế hoạch; chưa có frontend trong phạm vi.
