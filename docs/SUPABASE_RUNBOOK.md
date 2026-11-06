# Supabase Cloud — onboarding và deployment runbook

**Trạng thái 05/11/2026: IMPLEMENTED offline, BLOCKED activation.** Các lệnh dưới mô tả workflow đã chuẩn bị, không xác nhận Cloud chạy thành công. Không kết nối/đọc/ghi database main hoặc Supabase trong lượt triển khai source này. D1–D8 đã duyệt cho code; password lifecycle/provider/staging chưa xác minh. Theo yêu cầu mới nhất, chưa được kết nối. Xem [hướng dẫn biến môi trường chính xác](SUPABASE_ENVIRONMENT_SETUP.md).

## Đồng đội clone dự án

```powershell
git clone https://github.com/DAOMANHDUNG17/project_CNNT_22.git
cd project_CNNT_22
git switch feature/supabase-integration
npm.cmd install
```

Source hiện chưa commit/push: nhánh remote chưa chắc có các thay đổi trong checkpoint này. Chỉ sau khi maintainer review/push mới onboarding từ remote theo bản này. Root postinstall cài frontend bằng lockfile. Cần Node >=24.7. Khi PowerShell chặn npm.ps1, dùng npm.cmd, không đổi execution policy toàn máy. Luồng root install mới chưa được chạy end-to-end trong lượt này; các dependencies hiện có đã được cài từ checkpoint trước.

**Local-test**: dùng README hiện tại và `npm.cmd run dev`; giữ Redis/Docker như trước. Không dùng `setup:test-db`, `setup:test-infra`, integration/E2E hoặc launcher local đối với Cloud.

**Cloud — chỉ sau khi hoàn thành các gate**:

1. Nhận cấu hình/credential qua kênh riêng, không qua Git. Sao chép `infra/supabase/cloud.env.example` tới `.env.cloud` (đã ignore) hoặc thư mục bảo vệ bên ngoài repo. Không ghi đè `.env` local.
2. Đặt project ref và expected ref bằng target được duyệt. Host direct phải khớp ref. DB postgres, schema public; SQL roles chỉ warehouse_readonly/warehouse_backend. Không postgres runtime.
3. Nếu IPv6 direct không dùng được, chọn session pooler IPv4 host do Dashboard cung cấp, port5432. Giữ PGUSER ở dạng bare role; config thêm `.projectref` ở transport username. Không dùng transaction pooler6543.
4. Cài CA PEM từ provider qua kênh tin cậy, `PGSSLMODE=verify-full`, xác minh hostname. Không dùng rejectUnauthorized=false hoặc NODE_TLS_REJECT_UNAUTHORIZED=0. Kiểm signing algorithm/project keys thực tế; template cố ý để trống mode/algorithm, không đoán ES256.
5. Credential files không BOM/newline; giữ quyền đọc hẹp. HMAC key ngẫu nhiên >=32byte, giống nhau trên bốn backend để bucket chung; rotate có kế hoạch vì thay key làm reset bucket. Publishable key chỉ dành Auth; không dùng service role secret để login/JWT verification.

```powershell
$env:APP_ENV_FILE = 'C:\path-outside-repo\warehouse-cloud.env'
npm.cmd run dev:cloud
```

**Hiện tại lệnh sẽ dừng trước kết nối.** Thiếu env báo tên cấu hình; config hợp lệ vẫn báo CLOUD_RELEASE_BLOCKED. Không có env flag để bypass. Gỡ gate cần reviewed code change + evidence, không phải chỉ điền password.

Launcher đã chuẩn bị backend rồi chờ IPC ready mới mở Vite. Không Docker/Redis/migration/seed; pool reader/writer riêng. Vite nhận allowlist ba giá trị công khai, không nhận Cloud env path hay PG secrets; Cloud mode tắt tự load frontend env files. Frontend/Express mặc định5173/3000 qua same-origin proxy; template PORT3000 phải giữ phù hợp proxy hiện tại. Production reverse proxy/TLS/domain deployment là phạm vi riêng, chưa thiết kế để expose dev server.

## Auth và contract

- Cloud login dùng email/password với official SDK; backend chỉ nhận Bearer và xác nhận mapping. Username nghiệp vụ giữ nguyên.
- Token theo tab sessionStorage; reload/refresh SDK, Backend JWT + DB gate mới quyết định identity/role. Đóng tab mất local session; tab duplicate có thể sao chép sessionStorage, không coi tab là thiết bị độc lập. Logout app session sẽ ảnh hưởng mọi nơi cùng session_id.
- Các request ghi kiểm Origin exact. Không cookie fallback, không CSRF token giả, không tự retry POST/PATCH. Unknown stock COMMIT vẫn giữ UUID/payload như local.
- Cloud có 24 paths/29 operations trong OpenAPI review. Bốn Auth operations đổi transport/semantics; login-confirm/capability đổi method client. Hai user create/reset chưa khả dụng (503), 22 business operations khác giữ contract payload/response, health giữ.
- Đổi role/active tăng auth_version; candidate cutoff yêu cầu provider session mới. Profile-only không tăng. Không lấy business role từ metadata. Role-aware UI/route protection dùng identity Backend.
- UI tạo user/reset bị disable Cloud; Backend chặn hash path, SQL admin candidate chặn early PZA07; chưa có self-password/recovery endpoint, không thêm đường tắt.
- Swagger chọn spec Cloud theo profile, vẫn read-only, không lưu token và không Try it out.

## Gate triển khai (PLANNED, cần phê duyệt riêng)

- [x] Duyệt code D8; đã bổ sung bridge, checker owner/ACL/path/body và negative tests offline. Chưa xác minh SQL/provider.
- [ ] Chốt provider password/reset/recovery semantics, kể cả SDK ngoài UI; thiết kế/triển khai revocation authoritative và provisioning saga có reconciliation.
- [ ] Chọn staging **riêng**, synthetic accounts/data; ghi target/backup/restore/rollback owners. Không mặc định project dùng chung là test database.
- [ ] Phê duyệt read-only preflight: version thực tế, schemas/default ACL/roles/provider grants/Auth columns, TLS/IPv6/session pooler. Không đọc secrets/hash/session rows vào log.
- [ ] Review SQL, transaction runner/endpoint guard, exact manifest và pending assertions; chốt chiến lược backup/PITR theo plan thực tế.
- [ ] Phê duyệt migration staging riêng. Chạy10–80 trong một transaction, assertion fail phải rollback; không fixture test local.
- [ ] Cấp LOGIN/credential hai runtime qua kênh bí mật; ba executor luôn NOLOGIN; kiểm owner maintenance và revoke SET path.
- [ ] Provision synthetic users ADMIN/KEEPER/STAFF/VIEWER; map UUID→bigint; READY sau toàn bộ saga. Không tài khoản mặc định/password chung.
- [ ] Chạy security, Auth, API29 và E2E staging; reset/password/outage/replay/concurrency/last-admin/TEMP shadow tests.
- [ ] Load/latency với bốn máy: 2 pools ×3 connections ×4 =24 tối đa (chưa gồm provider/maintenance); kiểm quota, p95/p99, limiter cleanup/capacity/deadlocks/timeouts.
- [ ] Backup/restore thực tế và đối soát schema/counts/UUID/FK/history/inventory theo từng base unit, không cộng đơn vị khác loại.
- [ ] Chỉ sau nghiệm thu staging mới duyệt cutover riêng, freeze writes/source snapshot/checksum/import/reconcile, chuyển target, theo dõi.

## Rollback / containment

Trước migration: không có DB change để rollback; chọn local-test, giữ `.env` và Redis local. Không discard thay đổi user trong worktree. Sau migration lỗi trước COMMIT: ROLLBACK; không cố tiếp tục qua assertion.

Sau commit nhưng trước cutover: giữ Cloud runtime NOLOGIN, giữ objects để điều tra; không reset cluster/drop managed roles/schemas. Nếu cần trả defaults, phục hồi **đúng snapshot trước migration** của postgres/public; không GRANT lại rộng theo phỏng đoán.

Sau cutover hoặc khi có ghi Cloud: dừng ghi từ cả bốn backend, chụp backup/evidence, chạy containment đã duyệt (NOLOGIN + revoke function EXECUTE), xác minh/terminate đúng runtime PIDs. NOLOGIN không ngắt existing sessions, revoke không hủy transaction đang chạy. Giữ stock history, đối soát giao dịch outcome-unknown bằng UUID. Không trỏ ngay về bản local cũ vì có thể mất giao dịch/ghi đè tồn kho. Chỉ restore/replay có đối soát theo kế hoạch riêng; không rollback schema Auth bằng xóa mapping/FK.

Redis giữ nguyên cho local-test. Chỉ xóa dependency/modules sau khi Cloud nghiệm thu và chủ dự án quyết định bỏ local profile; không xóa âm thầm session/limiter hiện hành.

## Kiểm tra offline có thể lặp lại

```powershell
$env:APP_ENV_FILE = Join-Path (Get-Location) '.offline-no-env'
node --test test/*.test.js
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
node scripts/generate-cloud-openapi.js --check
node scripts/supabase/prepare-business.js --check
git diff --check
```

Không chạy `npm run test:all` (nó gồm integration thật). Unit dùng mock DB/Redis/Auth hoặc synthetic signed JWT + localhost HTTP; không phải bằng chứng Cloud hoạt động. Kết quả thực tế được ghi riêng trong [checkpoint](SUPABASE_IMPLEMENTATION_STATUS.md).
