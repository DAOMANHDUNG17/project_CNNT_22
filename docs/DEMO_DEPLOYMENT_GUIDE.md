# Deploy demo BTL Đề tài 22

Tài liệu đang áp dụng cho source hiện tại. Kết quả và điều kiện tại [Demo Readiness](DEMO_READINESS_REPORT.md). Chưa có thao tác deploy nào được thực hiện.

Trước commit/deploy, xem [Final Security Gate](DEMO_SECURITY_GATE.md), [allowlist commit](DEMO_COMMIT_FILES.txt) và [nội dung commit](DEMO_COMMIT_MESSAGE.md). Data API Off và giới hạn người dùng phải được xác nhận, không đưa script hardening/QA đang hoãn vào commit demo.

## Phạm vi source

Dùng nghiệp vụ ổn định `992845e`, cấu hình cloud D1.3/D1.4 và tính năng Account Settings/Password Management đã kiểm thử cô lập. JWT/RBAC và nghiệp vụ kho giữ nguyên. Auth refactor, private schema, warehouse_app và scripts migration được hoãn. Build/start không chạy SQL migration. Không đặt Pre-Deploy Command trên Render.

## Cấu hình chính xác

| Tham số | Render Backend | Vercel Frontend |
| --- | --- | --- |
| Root Directory | `backend` | `.` |
| Git branch | `deploy/cloud-readiness` | Production Branch: `deploy/cloud-readiness` |
| Framework | Node Web Service | Vite |
| Node | `24.15.0` qua NODE_VERSION | `24.x` |
| Install Command | Nằm trong Build Command | `npm ci --include=dev` |
| Build Command | `npm ci --include=dev && npm run build` | `npm run build` |
| Start Command | `npm run start:prod` | Không có |
| Output | `dist/main.js` | `frontend/dist` |
| Health Check | `/api/health` | Deep links/static assets |

Render đặt NODE_ENV production, HOST 0.0.0.0 và dùng PORT nền tảng cấp. FRONTEND_URL chỉ nhận đúng một origin HTTPS. DATABASE_URL, SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY dùng cấu hình ổn định trong secret settings. Chưa chuyển role database trong bản demo. [Render Web Services](https://render.com/docs/web-services)

Vercel dùng VITE_API_URL là origin HTTPS thật của Render, VITE_SUPABASE_URL và key publishable/anon public của cùng project. Không dùng Service Role Key hoặc DATABASE_URL ở frontend. Root vercel.json đã có rewrite SPA, Swagger redirect và noindex. [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json)

## Các điều kiện trước khi chia sẻ link

- Người dùng đã duyệt deploy, chỉ cấp account cho người tham gia, ADMIN do chủ dự án giữ.
- Người dùng xác nhận Data API đã Off và website vẫn hoạt động trong yêu cầu Account Settings ngày 25/11/2026. Giữ Off; không chạy SQL hardening đang hoãn. Đây là xác nhận của người dùng, không phải thay đổi Dashboard do agent thực hiện.
- Vercel Authentication bảo vệ All Deployments và thử ẩn danh trên mọi domain sẽ chia sẻ. Người không được cấp access có thể xem qua màn hình của chủ dự án. Không dựa vào Standard Protection hoặc URL bí mật như bằng chứng riêng tư.
- Render API vẫn là endpoint mạng public, các route nghiệp vụ cần JWT/profile/role. Nếu cần cả endpoint ẩn ở mức mạng thì dùng demo Local; không tạo thêm hạ tầng trong bước này.
- Backup business mới đã tồn tại ở `D:\SmartWarehouse-Demo-Readiness-2026-11-25`. Không chia sẻ archive hoặc `.env`.

## Smoke sau deploy được phép

Health 200, `/api/auth/me` không JWT 401, JWT ba role hợp lệ, các API đọc được phép, quản trị/ghi bị cấm đúng contract, CORS origin thật và Authorization preflight, deep links/reload, Swagger. Kiểm cả truy cập trực tiếp URL Render và Supabase Data API theo chính sách đã chọn, không chỉ đi qua frontend.

Phép kiểm ghi kho hoặc tạo account thật chỉ do người trình diễn chủ động thực hiện sau khi biết rõ dữ liệu và tài khoản đang dùng. Không chạy test destructive hoặc migration trên Supabase chính.

## Rollback demo

Lưu deployment và secret references trước chuyển traffic. Khi có lỗi, quay về build trước tương thích với cấu hình Supabase ổn định. Bản demo không đổi schema nên rollback ứng dụng không cần SQL hardening rollback. Không reset hoặc restore database tự động. Backup public không thay backup đầy đủ Auth/Storage.

Các artifact frontend được build trong nghiệm thu dùng origin/key fixture và phải build lại bằng thông số thật. Không deploy trực tiếp thư mục dist đang chứa fixture. Không cần Supabase QA đầy đủ cho quyết định demo có kiểm soát, nhưng không nâng kết luận này thành sẵn sàng vận hành công khai.


## Kiểm thử mật khẩu trước cloud

Xem [ACCOUNT_PASSWORD_MANAGEMENT_REPORT.md](ACCOUNT_PASSWORD_MANAGEMENT_REPORT.md). Route /settings dùng SPA fallback hiện tại, không thêm rewrite trùng. Swagger sống ở /api/docs và /api/docs-json có ba API mới; docs/openapi.json là hợp đồng lịch sử, không phải schema runtime hiện tại.

Backend dùng SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY chỉ ở server. Vercel không nhận key quản trị. Giữ Render một instance vì giới hạn 5 lần/15 phút theo actor đang dùng bộ nhớ, reset khi process restart. Không bật request-body logging/APM payload capture trên các route mật khẩu hoặc Auth; chỉ audit actor/target/time/result. Chỉ dùng HTTPS và FRONTEND_URL chính xác.

Trước deploy, người dùng thử thủ công bằng tài khoản thử nghiệm riêng đã được phép: đổi mật khẩu với mật khẩu cũ sai/đúng, đăng nhập lại, ADMIN reset người khác và STAFF/VIEWER bị chặn. Kiểm các chính sách mạnh hơn/MFA nếu tài khoản có bật. Không dùng tài khoản đang phục vụ demo để thử tự động. Sau đổi mật khẩu, JWT cũ có thể hợp lệ đến expiry; không tuyên bố thu hồi tức thì mọi phiên. Kết quả mật khẩu thực tế mới nhất theo người dùng là 13/14 PASS, một tiêu chí chưa xác minh thủ công; chưa có tên tiêu chí còn lại để gán kết quả chi tiết. Các số unit/HTTP/browser tests là kiểm thử riêng bằng doubles. Người dùng chỉ cho phép commit/push ở nhiệm vụ này, chưa deploy.


## Thứ tự cấu hình khi được phép deploy

Chọn nhánh deploy/cloud-readiness ở cả Render và Vercel. Render dùng một instance, Auto-Deploy Off nếu chưa muốn các lần push tự triển khai. Vercel đặt Root Directory là dấu chấm (repo root), Production Branch đúng nhánh, Node 24.x; root vercel.json đã xác định lệnh build và output.

Dùng URL HTTPS được nền tảng cấp, không dùng URL fixture trong dist Local. Vercel VITE_API_URL là origin HTTPS Render (source tự chuẩn hóa /api), VITE_SUPABASE_URL là project origin HTTPS, chỉ dùng public publishable/anon key. Render FRONTEND_URL là đúng origin HTTPS frontend, không có path hoặc wildcard. Giữ PORT do Render cấp, không hardcode.

Giữ Supabase Data API Off. Kiểm JWT/RBAC, CORS Authorization preflight và deep-link /settings sau deploy được phép. Cấu hình Vercel deployment protection/All Deployments theo khả năng thực tế của project trước chia sẻ, giữ roster demo và không chia sẻ ADMIN. Không bật capture request body cho các route mật khẩu/Auth. Không cần migration hoặc hạ tầng QA mới.