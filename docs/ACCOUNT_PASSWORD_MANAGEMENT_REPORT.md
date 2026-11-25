# Account Settings & Admin Password Management

25/11/2026 · Nhánh deploy/cloud-readiness · HEAD 992845e8d72600041ff63eb819f1a7d32316e133.

**Kết luận PARTIAL cho nghiệm thu mật khẩu thực tế: 13/14 PASS theo xác nhận của người dùng trong yêu cầu commit/push ngày 25/11/2026; một tiêu chí chưa xác minh thủ công.** Không nâng kết quả thành 14/14 hoặc thay bằng số test mock. Phần triển khai và kiểm thử tự động cô lập PASS.

### Cập nhật trước commit/push

| Nội dung | Trạng thái |
| --- | --- |
| Kiểm thử mật khẩu thực tế | 13/14 PASS, do người dùng cung cấp; agent không tự chạy lại thao tác mật khẩu thật |
| Tiêu chí còn lại | Chưa xác minh thủ công; yêu cầu hiện chưa cung cấp tên/số thứ tự tiêu chí, không tự suy đoán |
| Mật khẩu/phiên thật trong lần nghiệm thu trước | Các giới hạn ghi ở phần kiểm thử bên dưới là lịch sử kiểm thử bằng doubles của agent; được bổ sung bởi kết quả thực tế mới từ người dùng |
| Commit và push | Người dùng đã cho phép trên deploy/cloud-readiness, message: feat: prepare Smart Warehouse for cloud deployment |
| Deploy | Chưa được thực hiện trong nhiệm vụ này; giữ yêu cầu kiểm tra tiêu chí còn lại và các điều kiện demo trước chia sẻ |

Agent không đổi mật khẩu tài khoản thật, .env, schema, Supabase production hoặc nghiệp vụ KT1–KT3. Không lưu credential làm bằng chứng nghiệm thu.

## Chức năng đã triển khai

Dropdown tài khoản theo thứ tự Thông tin tài khoản → Cài đặt (Settings icon) → Đăng xuất. /settings yêu cầu đăng nhập, không thêm sidebar; breadcrumb, desktop/mobile và reload đã kiểm. Hiển thị họ tên, username, email chính mình, role và điểm quét từ provider phân công hiện có. Email lấy từ Supabase Auth /user được backend ràng buộc đúng Auth UUID, không công khai metadata hay token.

Form cá nhân có mật khẩu hiện tại/mới/xác nhận, hiện-ẩn, loading và chống double submit qua useMutation. Cả backend và frontend kiểm 8–128 ký tự, xác nhận khớp, khác mật khẩu cũ. Backend xác thực mật khẩu cũ với Auth password grant, kiểm UUID trả về, dùng Auth PUT /user kèm current_password. Supabase áp chính sách mạnh hơn của project. Session xác thực tạm chỉ tồn tại trong bộ nhớ, được yêu cầu logout local khi update thất bại, global sau thành công. Không tự hash hoặc lưu password trong database.

Sau thành công xóa form, SDK đăng xuất local và chuyển /login. Nếu logout chưa được ACK, vẫn báo mật khẩu đã đổi, kèm cảnh báo phiên chưa được xác nhận thu hồi đầy đủ. Không retry tự động khi update timeout/kết quả không rõ. Access JWT đã cấp có thể còn hợp lệ đến expiry; backend JWT/RBAC giữ nguyên.

Trang Users thêm nút ADMIN Đặt lại mật khẩu, modal Ant Design có username/email, hai ô mật khẩu hiện-ẩn, Hủy/Xác nhận và checkbox cảnh báo bắt buộc. Tự chọn chính ADMIN sẽ chuyển /settings. Backend không nhận Auth UUID từ client: dùng ID BIGINT dương, kiểm range, lấy binding từ database. Trong transaction account lock chỉ SELECT: kiểm lại ADMIN active, target tồn tại, UUID hợp lệ, rồi gọi Auth Admin PUT chỉ trường password. Không sửa business profile, role, trạng thái hay điểm quét.

Giới hạn server 5 attempts/15 phút theo actor cho cả hai mutation, gồm failure; từ chối concurrent request. Bộ đếm có TTL và giới hạn 1000 actor, chỉ cho demo một instance; không thay dependency. Audit chỉ actor/target/time/result, không raw exception/provider response. Lỗi dịch vụ trả thông báo an toàn tiếng Việt; DTO error không phản chiếu giá trị password.

## API và phân quyền

| Route | ADMIN | STAFF | VIEWER | Không JWT |
| --- | --- | --- | --- | --- |
| GET /api/account | Chính mình | Chính mình | Chính mình | 401 |
| PATCH /api/account/password | Chính mình + mật khẩu cũ | Chính mình + mật khẩu cũ | Chính mình + mật khẩu cũ | 401 |
| PATCH /api/users/:id/password | Người khác, active actor | 403 | 403 | 401 |
| Frontend /settings | Có | Có | Có | Chuyển login |

Password DTO dùng new_password, confirm_password; self thêm current_password. Không nhận role, email, auth_user_id hoặc user_id trong body. Admin route id là chuỗi PostgreSQL BIGINT, không phải Auth UUID. Kết quả mutation chỉ changed/requires_relogin/refresh_sessions_revoked; không có credential. refresh_sessions_revoked là ACK logout Auth, không cam kết mọi JWT đã vô hiệu; Admin reset trả false, không tự giả định thu hồi phiên.

Swagger runtime /api/docs và /api/docs-json tự sinh từ decorators: ba route mới, writeOnly password schemas, bearer guard, 400/401/403/404/429/503 và giới hạn phiên được mô tả. Contract test xác nhận tổng 23 operations trong bảy nhóm. Không thay docs/openapi.json lịch sử bằng một schema giả. Vercel rewrite hiện có đã bao phủ /settings; thêm test và xác nhận reload, không thêm rewrite trùng.

## File và phạm vi thay đổi

Các file bổ sung/chỉnh sửa cho tính năng này:

- backend/src/app.module.ts
- backend/src/users/users.module.ts
- backend/src/users/supabase-admin.service.ts
- backend/src/account/account.controller.ts
- backend/src/account/account.module.ts
- backend/src/account/password.dto.ts
- backend/src/account/password-attempts.service.ts
- backend/src/account/password-management.service.ts
- backend/src/account/password-attempts.service.spec.ts
- backend/src/account/password-auth.service.spec.ts
- backend/test/account-password.e2e-spec.ts
- backend/test/app.e2e-spec.ts
- frontend/src/App.tsx
- frontend/src/auth/AuthProvider.tsx
- frontend/src/layout/AppLayout.tsx
- frontend/src/pages/UsersPage.tsx
- frontend/src/pages/SettingsPage.tsx
- frontend/src/components/AdminPasswordModal.tsx
- frontend/src/lib/account-api.ts
- frontend/tests/unit/account-api.test.ts
- frontend/tests/e2e/account-password.spec.ts
- docs/ACCOUNT_PASSWORD_MANAGEMENT_REPORT.md

Ngoài ra backend-api.ts thêm xử lý lỗi hai route mới, production-config.test.ts thêm /settings; DEPLOYMENT_GUIDE, DEMO_DEPLOYMENT_GUIDE, DEMO_SECURITY_GATE, manifest/message/plan được cập nhật. Allowlist mới gồm 45 file: bổ sung README gốc để đồng bộ npm run dev và cách tránh trùng cổng; giữ backend/package.json, backend/README.md và cấu hình D1.3/D1.4. Danh sách chính xác: [DEMO_COMMIT_FILES.txt](DEMO_COMMIT_FILES.txt). Không chọn local helpers hoặc SQL đang hoãn. Đã kiểm npm run dev -- --help exit 0; giữ nguyên start:prod, dependency và lockfile.

## Build và kiểm thử thực tế

| Kiểm tra | Kết quả |
| --- | --- |
| npm.cmd run build (backend) | PASS, exit 0; dist/main.js có |
| Backend npm.cmd test -- --runInBand | 9 suites, 61/61 PASS, exit 0 |
| HTTP password e2e mới | 31/31 PASS, DB/JWT/Auth doubles |
| HTTP hồi quy 8 suites | 331/332 PASS lượt đầu; một expectation Swagger cũ chưa tính ba API mới |
| Chạy lại suite app sau cập nhật contract | 138/138 PASS, exit 0; 7 suite còn lại 194/194 PASS từ lượt hồi quy, không chạy lại vô ích |
| Frontend build + typecheck | PASS, exit 0; env fixture HTTPS, không sửa .env |
| Frontend unit liên quan | 3 files, 36/36 PASS |
| Browser Account Settings/Password | 11/11 PASS trên Edge headless, Auth/API intercepted toàn bộ |
| Browser Users hồi quy | 8/8 PASS; lỗi fixture self-target ở suite mới đã sửa và chạy lại 11/11 |
| Desktop/mobile | Quan sát ảnh 1440×1000 và 390px, bố cục đúng, không tràn ngang |
| /settings direct/reload | HTTP Local 200 và browser ba role PASS; Vercel rewrite unit PASS |
| Swagger đang chạy | 23 operations và ba route mới hiện diện |
| Supabase Health thật | HTTP 200, database connected; chỉ đọc |
| CORS Local hai origin | OPTIONS 204, đúng origin, cho Authorization; không gửi mutation |
| .env/lockfile, secret, scope | Audit lịch sử 44 file PASS; manifest trước push cập nhật thành 45 file và được kiểm tra lại cả nội dung staged. Không đưa .env thật/backup/SQL hardening/QA helper vào commit |

Các ca đã kiểm: sai mật khẩu cũ, password yếu/không khớp/giống cũ, provider policy lỗi, UUID mismatch, thành công, logout thất bại nhưng update thành công, temporary session cleanup, Admin đúng target BIGINT/Auth UUID, thiếu JWT, STAFF/VIEWER/inactive/demoted actor, target thiếu/binding sai, DTO field injection, 429/concurrent/TTL, response và audit không chứa password/token, không có SQL ghi profile/role/điểm quét. Browser kiểm menu, login protection, show-hide, form validation, double submit chỉ một request, clearing session/reload login và Admin self redirect.

Không chạy lại QA PostgreSQL/Supabase write suites hoặc tự động đổi password thật. Không tạo QA/Docker mới. Các lỗi trong bước test đầu là selector icon, mock query-string và contract Swagger đếm cũ; đã sửa đúng nguyên nhân. Không đổi test nghiệp vụ KT1–KT3 để đạt PASS.

### Git diff --stat (tracked, chưa tính các tệp mới)

    backend/.env.example                        |   3 +
     backend/src/app.module.ts                   |   2 +
     backend/src/main.spec.ts                    | 159 +++++++++++++++++++++++++---
     backend/src/main.ts                         |  99 ++++++++++++-----
     backend/src/users/supabase-admin.service.ts |  86 ++++++++++++++-
     backend/src/users/users.module.ts           |   2 +-
     backend/test/app.e2e-spec.ts                |   6 +-
     frontend/.env.example                       |   5 +
     frontend/src/App.tsx                        |   2 +
     frontend/src/auth/AuthProvider.tsx          |  13 ++-
     frontend/src/layout/AppLayout.tsx           |   9 +-
     frontend/src/lib/api.ts                     |   4 -
     frontend/src/lib/backend-api.ts             |  19 +++-
     frontend/src/lib/supabase.ts                |   4 +-
     frontend/src/pages/UsersPage.tsx            |   8 ++
     frontend/vite.config.ts                     | 120 ++++++++++++++++-----
     16 files changed, 452 insertions(+), 89 deletions(-)

## Runtime Local và checklist thủ công tham chiếu

Runtime Local dùng HOST=127.0.0.1, PORT=3000, frontend http://localhost:5173/settings. Các phiên kiểm thử do agent mở đã dừng để trả cổng cho terminal người dùng. Chỉ chạy một instance mỗi dịch vụ. Backend dùng cấu hình thật hiện có; **thao tác thành công trên UI sẽ đổi mật khẩu thật**. Chỉ dùng tài khoản thử nghiệm riêng được cho phép. Checklist sau là tham chiếu, không phải danh sách 14 tiêu chí đã được người dùng đánh dấu chi tiết; đối chiếu tiêu chí còn thiếu trước khi chạy bổ sung.

1. Đăng nhập tài khoản thử nghiệm ADMIN/STAFF/VIEWER đã được cấp, kiểm dropdown → Cài đặt, tên/email/role/điểm quét và reload. Không gửi credential vào chat.
2. Nhập sai mật khẩu cũ, mật khẩu ngắn, cùng mật khẩu cũ, xác nhận khác; phải có lỗi tiếng Việt và không thay mật khẩu. Backend phải từ chối old-password sai.
3. Đổi mật khẩu hợp lệ đáp ứng chính sách project, kiểm chuyển về login, reload vẫn yêu cầu login; thử đăng nhập mới thành công. Kiểm login cũ thất bại trong một cửa sổ riêng. Không ghi/chụp password hoặc token.
4. ADMIN chọn người dùng thử khác, kiểm cảnh báo và checkbox, Hủy không thay đổi, xác nhận reset thành công; dùng mật khẩu mới đăng nhập đúng target. Profile/role/phân công không đổi. ADMIN tự chọn chính mình đi /settings.
5. STAFF/VIEWER không thấy chức năng quản trị, trực tiếp API reset phải 403. Thiếu JWT 401. Không dán token hoặc password vào chat/log/screenshot; chỉ ghi status và kết quả.
6. Kiểm Auth policy thực tế nếu mạnh hơn minimum (độ mạnh, password đã rò rỉ nếu có tính năng), rate limiting, email-password Auth và MFA/SSO nếu tài khoản dùng. MFA/SSO cần bước xác thực bổ sung; code từ chối an toàn, không hạ chính sách.
7. Ghi nhận logout/session thực tế ở tab cũ, không coi JWT cũ hết hiệu lực tức thì. Sau kiểm thử bằng tài khoản riêng, xác nhận để mở gate deploy ở nhiệm vụ sau. Không tạo giao dịch kho.

## Rủi ro và việc chưa xác minh

- Kiểm thử thực tế mới nhất là 13/14 PASS theo người dùng, một tiêu chí chưa xác minh thủ công. Chưa có bảng kết quả chi tiết để gán trạng thái riêng cho policy, global logout, MFA/SSO hay JWT cũ. Không suy diễn các mục này PASS từ aggregate hoặc từ mocks; chưa chứng minh mọi phiên bị thu hồi tức thì.
- JWT offline có hiệu lực đến expiry. Admin reset không thay status/role hoặc hứa mọi session đã bị thu hồi. Nếu account bị chiếm, dùng quản lý profile active để chặn request nghiệp vụ sau đó theo quyết định quản trị.
- Timeout/DB commit acknowledgement mất sau Auth update có thể trả 503 dù password đã đổi; không retry tự động, kiểm đăng nhập trước khi thử lại. Không rollback password bằng giá trị cũ.
- Rate limit in-memory reset khi restart và không chia sẻ nhiều instance; chỉ dùng một instance demo. Không bật body capture trong proxy/APM/log cloud.
- postgres runtime owner/BYPASSRLS và Service Role Key vẫn có phạm vi cao. Giữ secrets server-only, account demo được duyệt, ADMIN hạn chế, Vercel deployment protection và backup ngoài project. Data API đã Off theo xác nhận người dùng, chưa đổi grants/RLS/default privileges.
- Build frontend còn cảnh báo chunk lớn hơn 500 kB, không ảnh hưởng exit code; không mở rộng sang refactor bundle.
- HTTPS production, Vercel protection và roster phải kiểm trên môi trường deploy sau khi được phép; Local dev không chứng minh production đã nghiệm thu.

## Bảo toàn, audit và rollback source

Backup source trước sửa: D:\SmartWarehouse-Demo-Readiness-2026-11-25\account-password-before (14 file, không copy .env). Bản baseline/Git bundle và backup business cũ vẫn giữ ngoài project. Audit cuối: D:\SmartWarehouse-Demo-Readiness-2026-11-25\final-gate-commit-audit.json; checksum các .env thật và ba lockfile đối chiếu preservation-before.json.

Rollback source nếu cần: dừng backend Local, khôi phục đúng 14 file từ backup sau review, khôi phục backend/test/app.e2e-spec.ts và frontend/tests/unit/production-config.test.ts về nội dung trước tính năng (HEAD cho contract app; giữ test cấu hình cloud đã có), cất các file mới của Account/password ngoài source. Build lại, khởi động đúng một backend. Không git reset --hard/clean, không restore database hoặc .env. Rollback code không hoàn tác mật khẩu đã đổi ở Auth khi người dùng thử thủ công.

Nguồn chính thức: [Supabase updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser), [Admin updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid), [password policy](https://supabase.com/docs/guides/auth/password-security), [signout/JWT limits](https://supabase.com/docs/guides/auth/signout). Transport HTTP khớp pattern Admin có sẵn; password update và policy đối chiếu [Auth user implementation](https://github.com/supabase/auth/blob/master/internal/api/user.go), [Auth Admin implementation](https://github.com/supabase/auth/blob/master/internal/api/admin.go). Không lấy thay đổi thư viện/dependency để thực hiện tính năng.

**Nghiệm thu mật khẩu thực tế PARTIAL: 13/14 PASS, một tiêu chí chưa xác minh thủ công. Người dùng đã cho phép commit/push bản chuẩn bị cloud; chưa thực hiện deploy trong nhiệm vụ này.**
