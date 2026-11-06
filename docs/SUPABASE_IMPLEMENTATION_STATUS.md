# Supabase integration — checkpoint hiện tại

Ngày cập nhật: **05/11/2026**. Đã tiếp tục sau checkpoint tạm dừng. Source đã lưu, **chưa commit/push**. Branch `feature/supabase-integration`, baseline `dd022569c9ad62a499a5ea9df80e9ffb8f37222c`. Không discard thay đổi khi tiếp tục.

## Phạm vi được phép hiện tại

D1–D7 và bổ sung D8 đã được chủ dự án duyệt code. Sau một tin nhắn cho phép kết nối, **yêu cầu gần nhất đã thu hẹp lại: chưa kết nối Supabase, chưa migration, không thay đổi database main local; chỉ chuẩn bị cấu hình không nhạy cảm, source D8 và kiểm thử offline**. Đây là giới hạn đang có hiệu lực; không dùng phê duyệt cũ để tự kết nối.

Cloud chính tương lai dùng PostgreSQL + Supabase Auth, không Redis. Ref `offprveszircoaxyaxpf`, direct host `db.offprveszircoaxyaxpf.supabase.co`, port5432/database postgres. Người dùng nói đã tạo dữ liệu; chưa có bằng chứng catalog/roles/functions được kiểm tra. **Không chạy fresh-schema scripts lên dữ liệu đã có**; cần inventory/drift/delta plan khi được phép read-only preflight.

Không có Cloud/local-main connection, migration, seed, user/role provisioning, Docker reset, E2E/integration thật hoặc secret commit. Chỉ đọc tài liệu công khai và chạy localhost HTTP mocks.

## Kết quả và giới hạn

| Trạng thái | Kết quả |
| --- | --- |
| IMPLEMENTED | Audit/target D1–D8; Cloud profile/config; JWT/Auth factory; application/server/launcher riêng không Redis; release gate trước connection |
| IMPLEMENTED | Frontend Cloud email login + official SDK sessionStorage, restore/refresh/logout controller, Bearer typed client; giữ local cookie/CSRF |
| IMPLEMENTED | Checker Cloud riêng cho roles/membership/TLS/functions/column ACL; D8 bridge owner postgres trong warehouse_private, chỉ auth executor; exact body/path/ACL checks |
| IMPLEMENTED | SQL review package final six-table baseline + mapping/session/rate candidates; stock definition giữ nguyên; admin create/reset early blocker; guard trước mọi mutation |
| IMPLEMENTED | Cloud Swagger24 paths/29 operations, root postinstall frontend, offline config CLI, read-only preflight source chưa được chạy |
| VERIFIED | Backend unit/regression **100/100 PASS**:78 cũ +22 mới; APP_ENV_FILE trỏ file không tồn tại để không tự load .env local |
| VERIFIED | Frontend unit **9/9 PASS**:5 cũ +4 session-controller mocks; strict typecheck PASS |
| VERIFIED | Local và Cloud profile production build PASS; Cloud build dùng public fixture tổng hợp, không gọi provider; chunk warning >500kB vẫn còn |
| VERIFIED | Generated Cloud OpenAPI equality/reference/client method checks; stock definition/static SQL guards; Git ignore env/private paths |
| VERIFIED | Actual .env.cloud OFFLINE diagnostic báo incomplete như dự kiến, không có yêu cầu mạng |
| BLOCKED | Activation: thiếu config thật, password/provisioning lifecycle chưa giải quyết, SQL/provider/staging/TLS chưa nghiệm thu |
| NOT TESTED | Cloud connection/Auth/SQL permissions/concurrency/limiter capacity/rollback/backup, browser Auth E2E, fresh-install/dev end-to-end |
| PLANNED | Provisioning saga, self-password/reset/recovery, approved inventory/delta migration/staging/cutover |

Cloud-specific build với public fixture đã hoàn tất tại ignored `frontend/dist/cloud-review`; strict typecheck PASS. Sau bổ sung kiểm tra quyền view/sequence, chạy lại6 tests checker/D8: PASS. `git diff --check`, generator consistency và syntax checks entrypoints đều PASS. Build/mock không chứng minh Cloud hoạt động.

## Cấu hình đã chuẩn bị

File thực tế **`D:\Project_CNNT\.env.cloud`**, không phải `D:\Project_CNNT.env.cloud` (không tồn tại khi kiểm tra). Đã điền ref/expected-ref/URL/host/port/database theo người dùng. `.env` local không sửa. Signing mode/algorithm để trống, publishable key là placeholder.

Còn thiếu: SUPABASE_PUBLISHABLE_KEY (công khai), SUPABASE_JWT_VERIFICATION/ALGORITHM theo signing setting thực, PGPASSWORD_FILE/WRITE_PGPASSWORD_FILE của hai runtime roles, CLOUD_RATE_HMAC_KEY_FILE (secret ứng dụng >=32byte), PGSSLROOTCERT (public CA PEM). Không tạo/đoán secret.

Paths mẫu là `.cloud-private/` cạnh env file; chưa tạo các file bí mật. `.env.cloud` và `.cloud-private/` được ignore. Loader không lấy PG/SUPABASE/CLOUD/VITE còn sót từ shell để bù env thiếu. [Hướng dẫn đầy đủ](SUPABASE_ENVIRONMENT_SETUP.md) ghi phân loại từng biến, cách lấy publishable key/algorithm/CA, bảo vệ file và CLI offline.

## File mới và file sửa

- Profile: `src/config/runtime-profile.js`, `cloud.js`, sửa `secure.js`; `scripts/lib/cloud-environment.js`; `infra/supabase/cloud.env.example`, `.gitignore`, ignored `.env.cloud`.
- Backend: `src/cloud/{jwt,auth,application,server,release-gate}.js`; `src/db/{cloud-access,cloud-column-policy,cloud-provider-bridge}.js`.
- Frontend: `src/auth/{profile,cloud-client,cloud-session}.ts`, `AuthProvider.tsx`, `lib/api.ts`, `lib/format.ts`, `pages/LoginPage.tsx`, `pages/UsersPage.tsx`, `swagger.ts`, `vite.config.ts`.
- Client/spec: `docs/api-client.ts`, `docs/openapi-cloud.json`, `scripts/generate-cloud-openapi.js`.
- Workflow: `scripts/dev-cloud.js`, `install-frontend.js`, `check-cloud-config.js`, root/frontend package manifests + lockfiles.
- SQL/diagnostic: toàn bộ danh sách và thứ tự ở [scripts/supabase/README.md](../scripts/supabase/README.md), gồm `55-provider-bridge.psql`, `preflight.js`.
- Tests: `test/cloud-{config,jwt,auth,client,access,application,artifacts,bridge}.test.js`; `frontend/tests/unit/cloud-session.test.ts`.
- Docs: README, architecture audit, target design, historical migration-plan banner, runbook, security review, env setup, checkpoint này.

Không sửa business routes/repositories, local `src/db/secure-access.js` hoặc `frontend/src/pages/MovementPage.tsx` của An. Redis giữ nguyên cho local-test. SDK Supabase2.119.0 và jose6.2.15 đã cài từ checkpoint trước; root postinstall workflow mới chưa được chạy end-to-end.

## Các điểm cần giữ khi tiếp tục

29 operations là số trong spec review, không phải29 Cloud PASS.22 business payload/response giữ;4 Auth semantics đổi;2 user create/reset còn503;health giữ. Backend không nhận password login Cloud, không CSRF token giả. Cloud client có confirmLogin/authCapabilities. Không tự retry stock mutation/đổi UUID.

D8 đã duyệt code: bridge chỉ SELECT created_at/not_after từ auth.sessions theo subject+session, owner postgres/path rỗng/schema riêng; chỉ auth executor gọi. Không cấp auth schema cho custom role, không write/lock/trigger managed Auth. SQL chưa chạy nên provider permissions/catalog body chưa được xác minh.

Session candidate dùng provider created_at/cutoff/epoch, idle30m/absolute8h, giữ revoked/idle rows đến absolute expiry, cap10k sessions. PG limiter candidate cap20k buckets, api-ip120/phút/api-user240/phút. Mocks không chứng minh atomicity/concurrency/cleanup/clock correctness của SQL.

Password/provisioning vẫn BLOCKED: cần authoritative invalidation cho reset/self-change/recovery kể cả SDK ngoài UI. Không dùng frontend callback, auth.users.updated_at chung hoặc đổi hash local làm bằng chứng revoke Auth. D8 approval không tự giải quyết blocker này. UI disable + Backend503 + SQL early PZA07.

`release-gate.js` và `review-gate.psql` còn chặn activation/mutation, không env flag bypass. `80-assertions.psql` còn cố ý fail về password/staging. `check:cloud-config` chỉ offline; `check:cloud` sẽ kết nối thật READ ONLY nên chưa được chạy.

## Bước tiếp theo

1. Kiểm status/branch, giữ mọi worktree edits. Đọc env setup + checkpoint; không chạy launcher local để thử Cloud.
2. Người dùng điền file env/private files, báo sẵn sàng; có thể kiểm `check:cloud-config` offline, không dump secret.
3. Tiếp tục code/offline cho phần đã chốt; trình phương án password/revocation cụ thể trước khi đổi kiến trúc.
4. Chỉ khi có phê duyệt kết nối mới mới chạy read-only preflight. User đã có dữ liệu: lập delta plan, không chạy10–80 fresh schema.
5. Không migration/provision/staging writes/cutover hoặc gỡ gate trước phê duyệt và evidence tương ứng.

Tài liệu: [Env setup](SUPABASE_ENVIRONMENT_SETUP.md), [Runbook/onboarding/rollback](SUPABASE_RUNBOOK.md), [Security review](SUPABASE_SECURITY_REVIEW.md), [D8](../scripts/supabase/55-provider-contract.md).
