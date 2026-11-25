# Smart Warehouse · Frontend Production Readiness

**D1.4 · 25/11/2026 · PASS**

## 1. Vấn đề phát hiện

- API client lặp lại cấu hình base URL ở GET, POST, PATCH và PUT. Khi thiếu `VITE_API_URL`, cả bản build production có thể mặc định về backend Local.
- Vite đóng gói trang Swagger cũ cùng OpenAPI JSON và tài liệu bàn giao từng mô tả Redis, KEEPER và kiến trúc Express. NestJS hiện có Swagger riêng tại `/api/docs`.
- Frontend dùng `BrowserRouter` và chưa có cấu hình fallback cho deep link trên Vercel. Kiểm tra toàn bộ route trong `App.tsx` cho thấy có các route lồng trong layout và guard theo vai trò.
- Repo root khai báo `frontend` là npm workspace. Root và frontend đều có lockfile v3. Đã đối chiếu manifest với lockfile và xác nhận lệnh root `npm run build` gọi script frontend `typecheck` rồi `vite build`. `npm run test` gọi `vitest run`. Script preview của frontend bind loopback và cấu hình Vite đặt cổng 5173.

## 2. Tệp thay đổi

| Tệp | Nội dung |
| --- | --- |
| `frontend/config/production.ts` | Xác minh cấu hình public cho build production, chuẩn hóa API prefix và xác minh loại khóa Supabase public |
| `frontend/vite.config.ts` | Chỉ đưa ba giá trị public đã xác minh vào bản production. Giữ tài liệu lịch sử trong dev server và tạo điểm chuyển đến Swagger hiện hành ở production |
| `frontend/src/lib/backend-api.ts` | Dùng chung một cách lấy base URL cho các phương thức HTTP |
| `frontend/src/lib/supabase.ts` | Giữ ưu tiên publishable key, hỗ trợ public anon key khi publishable key trống |
| `frontend/.env.example` | Ghi chú cấu hình Local, URL Render và tùy chọn public anon key cũ |
| `frontend/tests/unit/production-config.test.ts` | Kiểm thử cấu hình môi trường, allowlist và rewrite; giữ các test hiện có |
| `vercel.json` | Cấu hình build workspace và SPA routing tại root |
| `docs/FRONTEND_PRODUCTION_READINESS.md` | Báo cáo này |

`App.tsx`, `BrowserRouter`, AuthProvider, layout, các màn hình nghiệp vụ và xử lý giao dịch UUID/retry giữ nguyên. Các bản ghi trạng thái D1.1–D1.3 còn trong workspace và backup D1.1 vẫn tồn tại.

## 3. Cấu hình Local và LAN

- `npm run dev` tiếp tục dùng Vite và proxy cùng origin `/api` tới backend loopback. Cổng mặc định là 5173. Các listener host-only cố định chỉ mở trên giao diện mạng có địa chỉ tương ứng.
- `npm run dev:lan` và `npm run dev:lan:https` vẫn dùng cấu hình từ `.env.lan`, gồm `LAN_TEST_HOST` và các đường dẫn chứng chỉ khi dùng HTTPS. API prefix tương đối, proxy giữ nguyên header Authorization, query và body.
- Khi frontend chạy Vite trực tiếp và không có override, API dev vẫn mặc định `http://localhost:3000/api`.
- Dev server vẫn phục vụ `/swagger`, `/swagger/`, `/swagger/openapi.json` và `/swagger/AN_FRONTEND_HANDOFF.md`.

## 4. Cấu hình Production

- `VITE_API_URL` lấy từ địa chỉ HTTPS thực tế của Render. Chấp nhận origin hoặc origin có đúng một hậu tố `/api`, rồi chuẩn hóa về `<origin>/api`. Build từ chối thiếu URL, HTTP, localhost, literal IP, credentials URL hoặc path không phù hợp.
- `VITE_SUPABASE_URL` là origin HTTPS của project. Dùng publishable key hoặc public anon key. Build từ chối khóa dạng secret, JWT có role quản trị và khóa thiếu. Các lỗi cấu hình chỉ nêu tên biến hoặc yêu cầu định dạng. [Supabase API Keys](https://supabase.com/docs/guides/getting-started/api-keys)
- Production thay thế ba giá trị cấu hình public theo allowlist. `/swagger` và `/swagger/` dẫn đến trang chuyển tiếp tới `<origin Render>/api/docs`. OpenAPI, handoff và Swagger UI lịch sử vẫn nằm trong Git để dùng ở Local. [Vite Env Variables and Modes](https://vite.dev/guide/env-and-mode.html)

## 5. Cấu hình Vercel

| Mục | Giá trị |
| --- | --- |
| Root Directory | Root repository, tương ứng `.` và chứa `vercel.json` |
| Framework Preset | `Vite` |
| Install Command | `npm ci --include=dev` |
| Build Command | `npm run build` |
| Output Directory | `frontend/dist` |
| Node.js | `24.x` |
| Production Environment Variables | Ba giá trị public theo mục dưới. Backend Render dùng `FRONTEND_URL` là origin HTTPS thực tế của frontend |

Root lockfile quản lý workspace `frontend` khi cài từ root. File cấu hình dùng rewrite cho route React và dành đường dẫn riêng cho Swagger. Vercel kiểm tra filesystem trước rewrite. Các đường dẫn asset, license, API và tài liệu Swagger cũ nằm ngoài fallback SPA. [Vercel Configuration](https://vercel.com/docs/project-configuration/vercel-json) · [Vite SPA on Vercel](https://vercel.com/docs/frameworks/frontend/vite) · [Vercel Node.js Versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)

## 6. Tên biến môi trường

| Phạm vi | Tên biến | Mục đích |
| --- | --- | --- |
| Production và Local | `VITE_API_URL` | Backend API. Production bắt buộc, Local có mặc định hoặc proxy cùng origin |
| Production và Local | `VITE_SUPABASE_URL` | Supabase Project URL |
| Production và Local | `VITE_SUPABASE_PUBLISHABLE_KEY` | Public key ưu tiên |
| Production và Local | `VITE_SUPABASE_ANON_KEY` | Lựa chọn public cũ khi thiếu publishable key |
| Development | `VITE_MOCK_SCENARIO` | Tùy chọn mô phỏng lỗi Local |
| Local LAN | `LAN_TEST_HOST`, `LAN_TEST_TLS_CERT`, `LAN_TEST_TLS_KEY` | Listener host-only và TLS |
| E2E | `E2E_BASE_URL`, `E2E_SUPABASE_EMAIL`, `E2E_SUPABASE_PASSWORD`, `PLAYWRIGHT_NO_COPY_PROMPT` | Chỉ dùng cho Playwright có sẵn |

Chỉ một trong hai biến khóa public cần được cấu hình. Khi chọn public anon key, bản build đưa khóa đã xác minh vào vị trí cấu hình Supabase public của client. `DATABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` thuộc môi trường server.

## 7. Build, test và số lượng PASS/FAIL

| Kiểm tra | Kết quả |
| --- | --- |
| `npm.cmd run build` từ root | Exit 0. TypeScript và Vite production build PASS với Node `v24.15.0`, npm `11.12.1` |
| `npm.cmd run test` từ root | Exit 0. 17 tệp test, **87 PASS, 0 FAIL** |
| Build production thiếu `VITE_API_URL` | Exit 1 đúng kỳ vọng, thông báo xác định biến lỗi |
| npm ci dry-run trên bản sao manifest và lockfile | Exit 0 với workspace root |
| Bộ phân tích nguồn rewrite `path-to-regexp@6.1.0` dùng trong Vercel routing tooling | **20/20 PASS**, 0 FAIL |
| Playwright trên dist và mô phỏng rewrite qua HTTP loopback | **28/28 PASS**, 0 FAIL |
| Tài liệu lịch sử qua Vite development | **4/4 PASS**, 0 FAIL, cổng thực tế 5173 |

Các phép kiểm tra mô phỏng sử dụng API/Auth test doubles và dữ liệu tổng hợp. Bộ Playwright có sẵn sử dụng thông tin đăng nhập Supabase QA chưa được chạy vì chưa xác minh dữ liệu của môi trường đó được cô lập.

## 8. Kiểm tra dist và bảo mật

- `frontend/dist/index.html` tồn tại. Có 47 tệp đầu ra, gồm JavaScript, CSS, font, favicon và giấy phép static. Các asset entry đã trả HTTP 200 với đúng loại nội dung trong kiểm tra loopback.
- Bản build chỉ có `swagger/index.html` trong thư mục Swagger. Hai tài liệu lịch sử và sourcemap vắng mặt. Các chuỗi KEEPER còn lại thuộc label hoặc mock có sẵn trong UI, không phải tài liệu đóng gói.
- Quét dist xác nhận chỉ dùng API HTTPS test đã cấu hình, không có fallback localhost/LAN hay `/api/api`. Ba canary mô phỏng thông tin cấu hình server không xuất hiện. Không phát hiện DSN PostgreSQL, private key, JWT nguyên dạng hay giá trị khóa Supabase secret. Tiền tố kiểm tra định dạng khóa trong SDK không chứa giá trị khóa.
- Checksum của các tệp `.env` frontend cục bộ khớp trước và sau build. Dist hiện chứa cấu hình test tổng hợp.

## 9. Routing và Authentication

- Đã mở trực tiếp `/`, `/login`, `/products`, `/inventory`, `/transactions` có query, `/scan-points`, `/stock-movement`, `/users`, `/403` và đường dẫn lồng không tồn tại. Người chưa đăng nhập được đưa về `/login`.
- Với phiên mock, VIEWER nhận trang từ chối ở các route hạn chế, ADMIN vào và reload `/users`, STAFF vào `/stock-movement`, và React Router hiển thị trang 404 cho đường dẫn lạ. Tám request `/api/auth/me` được đối chiếu với header Bearer và prefix đúng.
- Cả hai URL Swagger dẫn tới endpoint Swagger hiện hành trong mock. URL asset thiếu và URL tài liệu Swagger cũ trả 404 trong mô hình. Browser test dùng cổng loopback thực tế 51760 và CORS trả từ mock cho đúng origin này. Cấu hình CORS backend D1.3 giữ nguyên.

## 10. Git diff --stat

Kết quả `git diff --stat -- frontend` cho các tệp đã được Git theo dõi

```text
 frontend/.env.example           |   5 ++
 frontend/src/lib/backend-api.ts |  14 +++--
 frontend/src/lib/supabase.ts    |   4 +-
 frontend/vite.config.ts         | 120 ++++++++++++++++++++++++++++++++--------
 4 files changed, 113 insertions(+), 30 deletions(-)
```

`git diff --stat` toàn workspace có 7 tệp, 331 dòng thêm và 73 dòng xóa, gồm ba thay đổi backend đã có từ D1.3. File cấu hình production, tệp test mới, `vercel.json` và báo cáo này đang ở trạng thái untracked. `git diff --check` PASS. Nhánh `main` và tag baseline giữ nguyên ở `992845e`.

## 11. Nội dung chưa kiểm chứng trên Vercel thật

- Build từ clean checkout trên Linux của Vercel, CDN và quy tắc rewrite chạy ở edge.
- Tên miền cuối cùng, CORS giữa Vercel và Render, Supabase Auth thực tế và khả năng truy cập Swagger trên Render.
- Vite báo một bundle chính hơn 500 kB sau minify, khoảng 1,37 MB trước gzip. Kết quả này không làm build thất bại. Chưa đo hiệu năng tải qua CDN.

## 12. Kết luận

**PASS cho D1.4.** Build, unit test, routing, Auth mock và kiểm tra đầu ra đều đạt. Công việc dừng ở cấu hình và kiểm chứng cục bộ trên `deploy/cloud-readiness`. Không có commit, push hoặc deploy.
