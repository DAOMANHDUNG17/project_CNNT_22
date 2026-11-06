# Supabase integration — security review offline

Ngày 05/11/2026. Review dựa source, unit/mock và tài liệu provider; **không phải audit Cloud thực tế**. Baseline local giữ nguyên checker/RBAC/stock repository; không đọc/ghi local main hoặc Supabase. Phê duyệt D1–D7 chỉ cho code. [Trạng thái](SUPABASE_IMPLEMENTATION_STATUS.md) và [runbook](SUPABASE_RUNBOOK.md) là nguồn nghiệm thu.

## Kết luận

**BLOCKED activation/cutover.** Source có Bearer/JWT/RBAC/Frontend integration, config/launcher, SQL candidates và tests. D8 đã được duyệt code và có bridge/checker/negative tests; password/provisioning lifecycle và provider/staging vẫn chưa xác minh. `release-gate.js` dừng trước pg pools/Auth calls; SQL review gate dừng trước mutation. Yêu cầu mới nhất của chủ dự án chưa cho kết nối Supabase. Không có env flag bypass; không có workflow tự migrate/seed.

## Kiểm soát đã IMPLEMENTED

| Rủi ro | Kiểm soát | Giới hạn chứng cứ |
| --- | --- | --- |
| Decode JWT/giả ADMIN | jose xác minh signature/issuer/audience/time/algorithm, subject/session UUID, role authenticated; không nhận key URL từ JWT; lấy business role DB mỗi protected request | ES256 synthetic ký thật; HS256 official SDK verification mocked; signing keys/rotation thật NOT TESTED |
| Cookie/CSRF downgrade | Cloud Bearer-only, Origin exact khi ghi; credentials omit, không tự retry writes hoặc tạo UUID mới | Không coi Origin thay JWT; XSS cùng origin vẫn có thể gửi token |
| Sai mapping/role/active | UUID→bigint chính xác; mapping thiếu/inactive/invalid role từ chối; auth_version/cutoff/session SQL candidate | Race check tại admission, không cam kết hủy request đã qua gate; business SQL tiếp tục recheck actor |
| Refresh giữ quyền cũ | SDK token chỉ là transport; mỗi /me và nghiệp vụ kiểm current DB role; controller epoch chống response cũ khôi phục user sau logout | Provider revoke/password semantics chưa chứng minh, session SQL chưa chạy |
| Credential leak | Env file riêng, không main .env fallback; hai low-privilege pools, public-only Vite allowlist; SDK publishable key, không service secret | Không có credential thật được tạo/đọc; chưa test install/new-machine end-to-end |
| TLS/nhầm target | Direct hostname ref, expected-ref, database postgres, SQL identities bare, session pooler5432, CA+hostname, rejectUnauthorized=true, timeout/pool bound | Certificate/network/pooler thực NOT TESTED; endpoint approval vẫn cần ngoài SQL |
| Quyền rộng | Cloud checker riêng: role flags, exact membership grantor/options, no outbound, no runtime DML/sequence/schema CREATE/database CREATE, exact function owner/signature/path/ACL, effective column matrix | Catalog query syntax/effective rights thực NOT TESTED; schema/constraint/body fingerprint cần staging verification bổ sung |
| Provider PUBLIC TEMP | Chỉ cho TEMP được hưởng PUBLIC; direct TEMP role grant và CREATE vẫn bị chặn. Fixed qualified SQL/search_path với pg_temp cuối | Temp-shadowing staging NOT TESTED; không revoke PUBLIC TEMP |
| API exposure | Candidate REVOKE PUBLIC/anon/authenticated/service_role trên đúng warehouse tables/sequences/functions; không bật Data API | Phải kiểm effective privileges/transitive memberships trên Cloud, không chỉ ACL text |
| Hash/password legacy | Cloud không cấp SELECT/INSERT/UPDATE password_hash; user create/reset Backend503 và SQL early blocker | Không thể tạo/reset Cloud user qua UI lúc này |
| Rate limit khi bỏ Redis | PG shared HMAC buckets, policy api-ip120/phút và api-user240/phút; candidate bounded cleanup20k buckets, no in-memory fallback | SQL chưa chạy/load-test; provider login brute-force settings chưa xác minh; không nói tương đương Redis limiter cũ |
| Stock double apply | Tái dùng nguyên hardened stock function body/repository, UUID/payload và outcome-unknown semantics | Static equality + existing mock regression; real concurrency/SQL tests NOT EXECUTED |

## Session storage và logout

sessionStorage theo tab đã được D2 duyệt; access/refresh token JS-readable. Không có bảo đảm chống XSS chỉ bằng storage choice. Không thêm dangerouslySetInnerHTML, token trong URL/log hoặc quyền nghiệp vụ từ metadata. Cần production CSP cùng origin/Auth connect allowlist, kiểm dependencies và kiểm CSP bằng browser trước cutover; CSP triển khai chưa làm. SDK tự refresh/restore; không await SDK trong callback Auth để tránh lock deadlock. Callback defer và controller epoch được unit test ở logic layer, **chưa browser E2E**.

Logout revoke application session trước, rồi provider signOut scope local. DB503 không bị coi là đã revoke; người dùng có thể thử lại. Nếu app revoke thành công nhưng provider thất bại, UI báo đúng chưa xác nhận signout provider. Không khẳng định provider JWT mọi nơi đã mất hiệu lực. Supabase chỉ dẫn kiểm `session_id` trong auth.sessions khi cần xác minh phiên, access JWT không tự mất hiệu lực ngay chỉ vì logout. [Supabase sessions](https://supabase.com/docs/guides/auth/sessions).

SQL admission candidate dùng provider created_at làm mốc absolute8h, không JWT iat sau refresh; idle30m dựa DB clock. Không xóa revoked/idle rows trước absolute expiry để tránh readmission. Cap10k session rows, advisory lock cho admission; row lock cho touch. Cleanup thất bại/outage/capacity từ chối truy cập. Không đọc/khóa/ghi Auth rows ngoài SELECT candidate. Phải test clock drift, concurrent refresh/logout/admin status, cleanup boundaries và load.

## D8 đã duyệt code, cần xác minh staging

Tài liệu Supabase xác nhận postgres không có grant option USAGE auth; GRANT cho custom role có thể warning/no-op. Provider đề xuất small postgres-owned DEFINER trong schema không exposed. Chủ dự án đã duyệt ngoại lệ này cho bridge D8: source SQL chỉ đọc created_at/not_after theo cặp subject/session, path rỗng, chỉ auth executor được gọi, strict body/ACL/schema checks. Không cấp authenticated membership hoặc nâng owner business function. [Provider restriction và bridge được hỗ trợ](https://supabase.com/kb/troubleshooting/permission-errors-when-granting-custom-roles-access-to-the-auth-schema-9e32e7). Chi tiết: [D8](../scripts/supabase/55-provider-contract.md).

Role creation có inbound membership do supabase_admin cấp cho postgres, ADMIN-only không INHERIT/SET. Checker chỉ chấp nhận đúng trường hợp đó; capability SET do postgres cấp để transfer owner phải gỡ trước commit. Không cố revoke provider grant không có quyền. [Provider memberships](https://supabase.com/kb/troubleshooting/cant-revoke-a-role-membership-granted-by-supabase_admin-d08922). SQL `GRANTED BY` chỉ thu hồi đúng grantor; syntax options có trong [PostgreSQL17 REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html).

## Password / provisioning chưa giải quyết

Không dùng auth.users.updated_at như password epoch vì trường đó có mục đích khác. Không dùng frontend callback để authoritative revoke; user có thể gọi Auth SDK trực tiếp. Chưa có evidence provider reset/self-change/recovery xóa đúng sessions và xử lý phiên hiện tại. Cần chốt trước khi code flows này; không tự thêm trigger vào managed auth schema.

Saga dự kiến: reserve app identity PENDING + operation key → provider create/update → reconcile immutable Auth UUID → chuyển READY và bump cutoff/epoch trong DB. Timeout có thể đã commit phía provider; không blind retry create để tạo danh tính đôi. Trường hợp outcome-unknown phải BLOCKED và operator reconciliation. Admin key phải cô lập, không đưa vào verifier/runtime thông thường hoặc browser. Chưa có ledger/API mới được triển khai; D7 là thiết kế, không phải feature đã hoàn tất.

## Checklist security staging bắt buộc

- [ ] JWT thật: rotation, expired/wrong-aud/iss/signature, missing mapping/disabled/provider outage.
- [ ] Bốn business roles; metadata/header/actor spoof; DB function execution/direct DML/sequence/API roles bị từ chối.
- [ ] Role/status/reset/self-password/recovery với access JWT còn hạn, refresh và nhiều thiết bị.
- [ ] SQL functions owner/search_path/ACL/body checksum, TEMP shadow, overload và malicious default privileges.
- [ ] Stock replay đúng/sai payload, historical request_scan_code NULL, concurrency/overflow/unknown COMMIT; last ADMIN races.
- [ ] Limiter atomicity ở bốn backend, cardinality/cleanup/latency, DB clock backwards/timeouts/outages, HMAC rotation.
- [ ] Browser sessionStorage denied/XSS/CSP/refresh/logout race và semantic401/403/503.
- [ ] Safe logs, safe env/bundle, wrong target/admin credentials/no TLS refusals.
- [ ] Backup/restore + rollback rehearsal; inventory/history đối soát, không ghi main/shared data trong tests.

Các hộp trên chưa được đánh dấu đạt bằng unit/mock. Không được gỡ release gate chỉ vì build/test offline xanh.
