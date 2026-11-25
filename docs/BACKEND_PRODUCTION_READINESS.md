# Smart Warehouse · Backend Production Readiness

**D1.3 · 25/11/2026 · PASS**

## Kiểm tra ban đầu

- Nhánh `deploy/cloud-readiness` ở `992845e` (`v1.0.0-pre-deploy`). Trước khi sửa, Git chỉ liệt kê `docs/GIT_READINESS_REPORT.md` ở trạng thái untracked.
- `backend/package.json` khớp với khai báo dependency trong lockfile v3. Các phiên bản NestJS, Postgres.js, TypeScript và Jest cài cục bộ đã được đối chiếu với lockfile. Node.js là `v24.15.0` và npm là `11.12.1`.
- Bootstrap bind cứng vào IPv4 loopback. Kiểu generic của `ConfigService.get` chỉ khai báo kiểu TypeScript nên `PORT` từ môi trường vẫn là chuỗi khi chạy. CORS dùng chung danh sách cho Local và Production. Mẫu môi trường thiếu `HOST`, `NODE_ENV` và `SUPABASE_SERVICE_ROLE_KEY`.
- Health Controller đã trả trạng thái sẵn sàng từ `DatabaseService.checkHealth()` và phản hồi 503 cố định khi database lỗi.

## Tệp thay đổi

| Tệp | Thay đổi |
| --- | --- |
| `backend/src/main.ts` | Xác minh `HOST`, chuyển `PORT` sang số nguyên và tách cấu hình CORS theo môi trường. Bootstrap giữ prefix `/api`, ValidationPipe, Swagger và shutdown hooks |
| `backend/src/main.spec.ts` | Kiểm thử Local, Cloud, CORS, cấu hình sai, prefix, ValidationPipe, Swagger và shutdown hooks |
| `backend/.env.example` | Bổ sung `NODE_ENV`, `HOST` và mục trống `SUPABASE_SERVICE_ROLE_KEY`, giữ các mục hiện có |
| `docs/BACKEND_PRODUCTION_READINESS.md` | Báo cáo nghiệm thu D1.3 |

## Cấu hình Local

- Nếu chưa khai báo `HOST` và `PORT`, backend bind vào `127.0.0.1:3000`. Một trong hai biến được khai báo với giá trị rỗng làm bootstrap báo lỗi trước khi mở cổng.
- Mẫu Local dùng `NODE_ENV=development`. CORS cho phép `http://localhost:5173` và `http://127.0.0.1:5173`. Khi đặt `FRONTEND_URL`, origin Local cấu hình trước đó được giữ trong danh sách.
- `PORT` phải là số nguyên thập phân từ 1 đến 65535. `HOST` nhận địa chỉ IP hoặc hostname đúng cú pháp.

## Cấu hình Render dự kiến

| Mục | Cấu hình |
| --- | --- |
| Service | Node Web Service, Root Directory `backend` |
| Node.js | Dùng `NODE_VERSION` để ghim `24.15.0`, cùng phiên bản đã kiểm thử |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm run start:prod` |
| HTTP Health Check Path | `/api/health` |
| Môi trường | `NODE_ENV=production`, `HOST=0.0.0.0` và `PORT` do Render cung cấp |
| CORS | `FRONTEND_URL` là một origin HTTPS của frontend. Bootstrap chuẩn hóa dấu gạch chéo cuối và cổng HTTPS mặc định. URL có wildcard, thông tin đăng nhập, path, query hoặc fragment sẽ bị từ chối |

CORS dùng so khớp chính xác một origin trong Production. Preflight của origin được phép tiếp tục chấp nhận header `Authorization`. Render dùng biến `PORT` và yêu cầu service nhận kết nối trên `0.0.0.0`. [Render Web Services](https://render.com/docs/web-services) · [Cấu hình phiên bản Node.js](https://render.com/docs/node-version) · [Render Health Checks](https://render.com/docs/health-checks)

## Tên biến môi trường

| Tên | Công dụng |
| --- | --- |
| `NODE_ENV` | Bật chế độ CORS Production khi chạy với `production` |
| `HOST` | Địa chỉ bind HTTP |
| `PORT` | Cổng HTTP, có mặc định Local |
| `FRONTEND_URL` | Origin bắt buộc trong Production, tùy chọn ở Local |
| `DATABASE_URL` | Kết nối PostgreSQL, bắt buộc khi khởi động |
| `SUPABASE_URL` | URL HTTPS của Supabase cho kiểm tra JWT/JWKS và Auth Admin, bắt buộc khi khởi động |
| `SUPABASE_SERVICE_ROLE_KEY` | Khóa chỉ dùng phía backend cho thao tác quản trị tài khoản Supabase |
| `SUPABASE_ANON_KEY` | Mục được giữ trong mẫu hiện có. Source backend hiện không đọc biến này |

`NODE_VERSION` thuộc cấu hình nền tảng Render. Các biến chỉ dành cho bộ QA là `QA_ACCESS_ANON_KEY`, `QA_ACCESS_DATABASE_URL`, `QA_ACCESS_SUPABASE_TEST`, `QA_DATABASE_URL`, `QA_HISTORY_DATABASE_URL`, `QA_USERS_ADMIN_ACCESS_TOKEN`, `QA_USERS_ADMIN_EMAIL`, `QA_USERS_ADMIN_PASSWORD`, `QA_USERS_ANON_KEY`, `QA_USERS_DATABASE_URL`, `QA_USERS_SERVICE_ROLE_KEY`, `QA_USERS_SUPABASE_DATABASE_URL`, `QA_USERS_SUPABASE_TEST` và `QA_USERS_SUPABASE_URL`.

## Build và kiểm thử

| Lệnh hoặc phép kiểm tra | Kết quả |
| --- | --- |
| `npm.cmd run build` | PASS, exit code 0 |
| `npm.cmd test -- --runInBand` | PASS, exit code 0. 7 suite, 44 test PASS, 0 FAIL |
| `Test-Path .\dist\main.js` | `True` |
| Kiểm tra TypeScript strict cho `main.spec.ts` | PASS, exit code 0 |
| Smoke test trên HTTP loopback bằng Nest/Express cô lập | 11/11 PASS, exit code 0 |
| `git diff --check` | PASS |

Smoke test dùng bootstrap đã build, controller thật và database double. Cả hai origin Local có preflight 204. Production có preflight 204 cho origin đã cấu hình và trả header cho phép `Authorization`. Hai origin Local và một tên miền Vercel khác đều thiếu header cho phép origin trong Production. Kiểm tra cũng xác nhận `/health` trả 404, `/api/docs-json` trả 200 và lệnh chạy entry point đã build thoát mã 1 với thông báo an toàn khi `PORT` sai.

Các tình huống lỗi Supabase Auth trong unit test là lỗi giả lập đã được kiểm tra. Các bộ QA có thể tác động PostgreSQL hoặc Supabase và các bộ e2e ngoài smoke test cô lập không được chạy trong D1.3. Kết nối từ Render tới Supabase, cài dependency mới trên runtime Linux của Render và deploy thực tế chưa được kiểm thử trong phạm vi nghiệm thu này.

## Health Check và khả năng kết nối PostgreSQL

- `GET /api/health` trả HTTP 200 với `status: ok` và `database: connected` khi database double sẵn sàng.
- Khi database double phát sinh lỗi, endpoint trả HTTP 503 với body chỉ có `status: error` và `database: disconnected`. Chi tiết lỗi nội bộ vắng mặt trong phản hồi.
- Service hiện kiểm tra bằng `SELECT 1`, yêu cầu TLS và có timeout kết nối 5 giây. Schema, cấu hình TLS, chế độ pooler và chuỗi kết nối thật giữ nguyên.
- Kết nối trực tiếp Supabase mặc định dùng IPv6. Với đường ra IPv4 của Render, Supavisor session mode phù hợp cho backend chạy lâu dài khi cần endpoint IPv4. Endpoint direct có IPv4 cũng có thể phù hợp. Khả năng truy cập endpoint thực tế vẫn cần được xác minh từ Render. [Render và Supabase Postgres](https://render.com/articles/how-to-connect-a-render-service-to-supabase-postgres) · [Các chế độ kết nối Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres)

## Git diff và rủi ro còn lại

```text
 backend/.env.example     |   3 +
 backend/src/main.spec.ts | 159 ++++++++++++++++++++++++++++++++++++++++++-----
 backend/src/main.ts      |  99 ++++++++++++++++++++---------
 3 files changed, 218 insertions(+), 43 deletions(-)
```

Hai báo cáo trong `docs/` ở trạng thái untracked nên nằm ngoài `git diff --stat`. `main` và tag baseline vẫn trỏ `992845e`. Báo cáo D1.1 và thư mục backup D1.1 vẫn tồn tại. Diff các tệp nghiệp vụ, auth, Health Controller, DatabaseService, frontend, manifest và lockfile đều rỗng. Checksum tệp `backend/.env` trước và sau khi build/test khớp nhau.

Render chờ tối đa 5 giây cho HTTP health probe. Kết nối PostgreSQL chậm có thể làm probe hết thời gian dù endpoint hoạt động đúng trong test cô lập. Kết quả kết nối với credential thật và origin frontend cuối cùng vẫn cần xác minh khi triển khai. [Render Health Checks](https://render.com/docs/health-checks)

## Kết luận

**PASS cho D1.3.** Build, unit test và kiểm tra HTTP cô lập đáp ứng yêu cầu nghiệm thu. Công việc dừng ở trạng thái chuẩn bị backend. Thay đổi nằm trên `deploy/cloud-readiness` và chưa được commit, push hoặc deploy.
