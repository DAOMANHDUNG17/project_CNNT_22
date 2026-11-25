# Demo Security Gate · BTL Đề tài 22

25/11/2026. **Người dùng đã cho phép COMMIT/PUSH bản chuẩn bị cloud trên deploy/cloud-readiness. Nghiệm thu mật khẩu thực tế PARTIAL: 13/14 PASS, một tiêu chí chưa xác minh thủ công. Chưa deploy.** Kết quả thực tế do người dùng cung cấp; chưa có tên/số thứ tự tiêu chí còn lại nên không tự gán PASS cho tiêu chí cụ thể hoặc nâng thành 14/14.

## Data API và kiến trúc

Người dùng xác nhận trong yêu cầu Account Settings rằng đã tắt Supabase Data API và website vẫn hoạt động bình thường. Xác nhận này thay thế ảnh công tắc On và trạng thái chờ Dashboard trong báo cáo trước. Agent không thao tác Dashboard, không bật/tắt dịch vụ hoặc đổi grants/RLS.

Frontend sử dụng Supabase Auth (đăng nhập, đọc session, đăng xuất). Toàn bộ nghiệp vụ và đổi mật khẩu mới đi qua NestJS. Backend truy vấn PostgreSQL trực tiếp, quản lý mật khẩu qua HTTPS Auth /auth/v1/user, /token, /logout và /admin/users/:uuid. Không dùng .from(), .rpc() hay REST bảng nghiệp vụ. Giữ Data API Off, không áp dụng migration hoãn.

## Tính năng mới và giới hạn phiên

/settings được bảo vệ cho ADMIN/STAFF/VIEWER, nằm ở dropdown tài khoản. Backend xác thực lại mật khẩu cũ bằng password grant và ràng buộc UUID trước khi cập nhật chính mình. ADMIN reset dùng ID BIGINT nghiệp vụ, ánh xạ Auth UUID từ database; kiểm ADMIN active lại dưới account lock. Không ghi public.users, role hoặc điểm quét trong luồng mật khẩu.

Hai API mật khẩu chia sẻ giới hạn 5 lần/15 phút theo actor được xác thực, chặn đồng thời trong một process. Audit chỉ có actor, target, time và result. Không ghi request body, provider response, password hay token. Giới hạn này chỉ phù hợp demo một instance; restart làm mất bộ đếm.

Sau đổi mật khẩu cá nhân, backend yêu cầu global logout và frontend dùng SDK signOut local để xóa session trên thiết bị, yêu cầu đăng nhập lại. Trường refresh_sessions_revoked là ACK từ Auth logout, không chứng minh mọi JWT đã vô hiệu. JWT cũ có thể còn hợp lệ đến expiry vì backend xác minh JWT offline. ADMIN reset không hứa hẹn thu hồi tức thì mọi phiên. Nếu tài khoản bị chiếm, quản trị viên cần vô hiệu hóa business profile qua chức năng hiện có; AuthGuard sẽ kiểm active lại ở request tiếp theo.

## Kiểm soát truy cập demo

- Frontend: cấu hình Vercel Authentication cho All Deployments và kiểm cửa sổ ẩn danh trên mọi domain. Chỉ người được duyệt có quyền xem, hoặc trình chiếu từ phiên của chủ dự án. Không chia sẻ bypass token. Xác minh tính năng thực tế của plan/project trước chia sẻ. [Vercel production protection](https://vercel.com/changelog/protect-production-deployments-for-free-on-every-plan)
- Backend: JWT ký hợp lệ + public.users liên kết, active và role server. Quản trị viên rà danh sách, chỉ giữ profile demo được duyệt active và giữ ít nhất một ADMIN; agent không tự sửa roster.
- Render endpoint vẫn public ở mức mạng; health và Swagger còn public. Vercel protection không phủ Render. Nếu yêu cầu ẩn toàn bộ endpoint ở lớp mạng, cấu hình hiện tại chưa đáp ứng. [Render inbound rules](https://render.com/docs/inbound-ip-rules)
- CORS, noindex, URL khó đoán và trang login không thay cho kiểm soát quyền. Không chia sẻ ADMIN cho người xem demo.

## Source, cấu hình và commit

Manifest hiện có **45 file**: [DEMO_COMMIT_FILES.txt](DEMO_COMMIT_FILES.txt). Gồm README gốc đồng bộ npm run dev và xử lý trùng cổng, backend/package.json và backend/README.md; giữ nguyên start:prod. Bao gồm tính năng mật khẩu, tests và cấu hình cloud đã nghiệm thu; loại SQL, hardening/QA helpers, backup, .env thật và build artifacts. Chỉ stage đúng manifest, kiểm staged diff trước commit; sau commit index phải rỗng. [Commit plan](DEMO_COMMIT_PLAN.md), [commit message](DEMO_COMMIT_MESSAGE.md).

UsersService/UsersController, backend JWT/RBAC, database, stock/inventory và nghiệp vụ KT1–KT3 vẫn khớp HEAD. Chỉ mở rộng transport Supabase Admin và thêm AccountModule; không tiếp tục Auth refactor/private schema/runtime role đang hoãn. Không đổi dependency hoặc lockfile.

| Cấu hình | Render | Vercel |
| --- | --- | --- |
| Root | backend | . |
| Node | NODE_VERSION=24.15.0 | 24.x |
| Install/build | npm ci --include=dev && npm run build | npm ci --include=dev; npm run build |
| Start/output | npm run start:prod; dist/main.js | frontend/dist |
| Health | /api/health | Deep-link /settings |
| Pre-Deploy Command | Để trống | Không migration |

Render: NODE_ENV=production, HOST=0.0.0.0, PORT do nền tảng cấp, FRONTEND_URL là đúng origin HTTPS. DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY chỉ ở server. Vercel chỉ nhận VITE_API_URL, VITE_SUPABASE_URL và public publishable/anon key. /settings đã nằm trong SPA rewrite hiện có, unit test và reload browser đã kiểm. Swagger sống có 23 operations, bao gồm ba API mới. [Deployment guide](DEPLOYMENT_GUIDE.md)

Build frontend trong nghiệm thu dùng origin/key fixture, không upload dist này làm release. Build lại từ source với biến public thật khi được cho phép deploy. Các log/APM cloud không được capture password request bodies. Giữ một backend instance cho giới hạn tần suất hiện tại.

## Bằng chứng kiểm tra

- Backend build và 61 unit tests PASS.
- HTTP isolated doubles: 332 ca. Lần hồi quy có 331 PASS, một expectation Swagger đếm API cũ thất bại; cập nhật đúng 23 operations và chạy lại toàn bộ suite app 138/138 PASS. Bảy suite còn lại 194/194 đã PASS, source nghiệp vụ không đổi.
- Frontend build/typecheck PASS; 36 unit liên quan PASS; 11 browser ca mới PASS, 8 browser ca Users hồi quy PASS. Đã sửa selector icon trang trí và đường dẫn mock có query string, không sửa nghiệp vụ để qua test.
- Xem [báo cáo nghiệm thu](ACCOUNT_PASSWORD_MANAGEMENT_REPORT.md) và audit checksum/secret ngoài project tại D:\SmartWarehouse-Demo-Readiness-2026-11-25\final-gate-commit-audit.json.
- Audit lịch sử 44 file đã PASS; trước commit/push rà lại manifest 45 file và cả nội dung staged, đối chiếu ba .env và ba lockfile, source KT1–KT3 và JWT/RBAC. Không chạy lại hàng trăm test nếu checksum source không đổi. Lệnh npm run dev -- --help exit 0; phiên kiểm tra runtime đã dừng để trả cổng cho người dùng.
- Agent kiểm Auth bằng doubles và không đổi mật khẩu hay dữ liệu Supabase thật. Người dùng báo kết quả kiểm thử mật khẩu thực tế **13/14 PASS**, một tiêu chí chưa xác minh thủ công. Đây là bằng chứng bổ sung từ người dùng, không phải 14/14 đã được agent kiểm chứng. Health/Supabase đã có kiểm tra chỉ đọc; không dùng kết quả mạng sandbox để thay connection string.

## Rủi ro còn lại và bước tối thiểu

postgres owner/BYPASSRLS vẫn là rủi ro High: chiếm backend hoặc lộ DATABASE_URL có thể tác động rộng. Tắt Data API không giảm quyền connection này. Giữ credential trong server settings, parameterized SQL, DTO và guard; chỉ dùng account demo được duyệt, giới hạn ADMIN/thời gian mở, có backup ngoài project, không đưa dữ liệu nhạy cảm vào demo. Không chuyển warehouse_app hoặc chạy migration trong nhiệm vụ này.

Service Role Key có khả năng quản trị Auth; không đưa vào frontend/log. Leaked Password Protection Disabled và grants/default privileges rộng từ audit cũ chưa được thay đổi. Không tuyên bố đạt mức vận hành công khai. Nếu có dấu hiệu lộ credential hoặc account bị chiếm, dừng demo và xử lý qua kênh quản trị; không chỉ đổi password rồi coi JWT cũ đã bị thu hồi.

Người dùng đã duyệt commit/push 45 file lên đúng nhánh, với message feat: prepare Smart Warehouse for cloud deployment. Push không force, không tags, không main; xác minh hash Local/Remote và refs baseline trước/sau. Đây không phải sự chấp thuận deploy hoặc công khai ứng dụng. Trước chia sẻ bản cloud cần xác định/xác minh tiêu chí còn lại và cấu hình Vercel protection, roster, HTTPS/CORS/ba role/deep links theo kế hoạch. Không cần xây Supabase QA mới hay Docker.

**Commit/push bản chuẩn bị cloud được người dùng cho phép. Nghiệm thu mật khẩu thực tế vẫn PARTIAL: 13/14 PASS và một tiêu chí chưa xác minh thủ công. Dừng sau push và xác minh; chưa deploy Render/Vercel.**
