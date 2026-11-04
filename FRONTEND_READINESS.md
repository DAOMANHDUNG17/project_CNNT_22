# Frontend readiness — Premium Red Enterprise và bàn giao An

Ngày thực hiện: **05/11/2026, Asia/Bangkok**.

## Cập nhật tinh gọn sidebar

Sidebar desktop/mobile chuyển sang trắng, mục chọn có nền xám nhẹ và chữ/icon đỏ. **Tổng quan** đổi thành **Trang chủ** với icon ngôi nhà. Đã bỏ pill database, dòng mô tả dưới logo, nhãn không gian làm việc, khối giới thiệu cuối sidebar và các eyebrow/mô tả phụ ở đầu các trang quản lý. Giữ nguyên nội dung dữ liệu, thao tác và phân quyền.

Đợt tinh gọn được kiểm tra lại bằng TypeScript/production build và 5 unit test frontend. Kết quả E2E và ảnh nêu ở phần dưới thuộc lượt redesign trước đợt tinh gọn này; không coi là ảnh hoặc E2E mới của sidebar trắng.

## Phạm vi bàn giao

Thiết kế lại frontend hiện có; không dựng dự án mới. Các trang Login, Dashboard, Sản phẩm & đơn vị, Tồn kho, Lịch sử giao dịch, Điểm quét và Người dùng dùng chung design system đỏ, font Be Vietnam Pro local, card trắng, border/shadow nhẹ và layout responsive.

Trang `/stock-movement` được thay có chủ ý bằng **Đợi An phát triển**. Giữ route, menu và guard ADMIN/KEEPER/STAFF; VIEWER vẫn bị chặn. Trang chờ không có form, camera, mã quét hoặc nút POST giao dịch. Dashboard và Điểm quét dẫn đến trang chờ. Source vận hành cũ được lưu tại `docs/reference/MovementPage.before-handoff.tsx`, helper pending/UUID được giữ nguyên.

Swagger tại **http://127.0.0.1:5173/swagger/** dùng trực tiếp `docs/openapi.json`. Đây là entry tài liệu riêng, không thêm endpoint Express. Tắt Try it out, authorization persistence và validator bên ngoài. Dùng typed client với session/CSRF để thử API trên test. Tài liệu bàn giao: [AN_FRONTEND_HANDOFF.md](docs/AN_FRONTEND_HANDOFF.md).

## Design system

Nguồn: `frontend/src/theme.ts`; áp vào ConfigProvider và CSS variables.

| Thành phần | Quy ước |
| --- | --- |
| Primary / hover / active | #B42332 / #CC3342 / #8F1724 |
| Sidebar / mục được chọn | #FFFFFF / #F0F0F1, chữ #B42332 |
| Branding Login | #831C28 / #661520 |
| Nền / surface / border | #F6F7F9 / #FFFFFF / #E5E7EB |
| Heading / body / muted | #20242D / #344054 / #667085 |
| Success / warning / error | #16866C / #D99A20 / #D92D20 |
| Font | Be Vietnam Pro local 400/500/600/700; Inter, Arial, sans-serif fallback |
| Kích thước | Card 16px, control 42px, desktop padding 32px, mobile 16px |

Không thêm KPI giả, thông báo giả, trạng thái scanner online hoặc endpoint không tồn tại. Giữ các cột, tìm kiếm, bộ lọc, phân trang và thao tác CRUD. Dashboard giữ totals riêng theo đơn vị, biểu đồ SVG dùng count thực; ResizeObserver giữ nhãn biểu đồ dễ đọc khi đổi chiều rộng. Các bảng số liệu chính xác và native tooltip vẫn có.

## An cần tiếp tục

- Xây UI quét mã và form nhập/xuất trong `frontend/src/pages/MovementPage.tsx`.
- Dùng typed client hiện có và tái sử dụng theme/components.
- Áp station hợp lệ, RBAC, xác nhận nghiệp vụ, chống double-submit.
- Giữ UUID/payload bất biến trước HTTP và khi retry/reload/mất response.
- Hiển thị CREATED/DUPLICATE, thiếu tồn, lỗi mã/điểm quét, phiên hết hạn và lỗi backend.
- Khôi phục hai kịch bản E2E form đang pending, phối hợp Vy nghiệm thu.

Chi tiết các API thực, setup test, trách nhiệm Dũng/An/Nam/Vy, ví dụ request và checklist tại tài liệu bàn giao. Không có camera/USB protocol mới trong đợt này.

## Kiểm chứng

| Kiểm tra | Kết quả đã chạy |
| --- | --- |
| Frontend typecheck | PASS; TypeScript strict |
| Production build | PASS; có entry app, Swagger và tài liệu chuẩn |
| Frontend unit | PASS 5/5; số bigint và pending/UUID/deadline |
| Backend unit/regression | PASS 78/78 |
| Backend integration thật | PASS 29/29 trên PostgreSQL/Redis test |
| E2E frontend | PASS 10/10 kịch bản đang hoạt động; 2 kịch bản UI nhập/xuất SKIPPED chờ An |
| Responsive | PASS kiểm tra không tràn toàn trang: Dashboard 1440/1366/1024/768/390px; các trang quản lý và trang chờ 1440/768/390px |
| Swagger | PASS 29 operation blocks; request body/status được hiển thị; không có Try it out; JSON và Markdown build trùng nguồn |
| Diff backend/contract | PASS không thay đổi src/, infra/, OpenAPI và typed client |

Lượt E2E đầy đủ cuối: **12 tests, 10 passed, 2 skipped, 0 failed, 0 flaky**, khoảng 90 giây. Hai test skip được giữ nguyên kịch bản để An tiếp tục: IN/OUT qua form và mất response sau commit rồi reload/retry cùng UUID. Không tính hai test này là PASS. Kịch bản hai phiên/điểm quét cùng xuất vẫn chạy qua API thật và xác minh một CREATED, một INSUFFICIENT_INVENTORY, tồn cuối đúng 20.

Đã kiểm tra login/session restore, HttpOnly/SameSite cookie, proxy, đủ ba API Dashboard, CRUD sản phẩm/đơn vị, đổi tên/status, inventory/low-stock/detail, scan-point CRUD/link, user CRUD/role/status/reset password, guard và logout. Kịch bản responsive không ghi nhận JavaScript pageerror. Các 401/403/409 có chủ ý trong test xác thực/phân quyền/thiếu tồn không phải lỗi hồi quy.

Ảnh thực tế do Playwright tạo và đã được xem lại: `frontend/artifacts/dashboard-1440.png`, `dashboard-768.png`, `dashboard-390.png`, `products-1440.png`, `users-390.png`, `product-create-modal.png`, `product-details-drawer.png`, `user-reset-modal.png`, `handoff-desktop.png`, `swagger-desktop.png`. Có thêm ảnh Inventory, Transactions, Scan Points và Login tại cùng thư mục. Ảnh modal reset được chụp trước khi nhập mật khẩu. Nhãn chart giữ kích thước khi resize; số bigint dài xuống dòng trong card trên mobile thay vì làm tràn trang.

Các lượt đầu đã phát hiện và sửa locator thiếu phân biệt dialog, ID password trùng và tình huống khởi động lạnh vượt 20 giây. Có một lỗi GET transport ECONNRESET; GET test hiện thử lại tối đa một lần, không sửa hoặc tự retry giao dịch ghi. Kết quả nêu trên là lượt cuối sau sửa, không cộng các lần chạy thử vào số PASS.

Backend integration gồm 29 operations qua typed client/OpenAPI, session/CSRF/RBAC, ACL, idempotency và chống xuất vượt tồn. Không dùng main. Chỉ số 29 test và 29 API là hai khái niệm khác nhau; báo cáo máy tại `docs/backend-api-verification.json` được cập nhật bởi suite hiện có.

Các kiểm thử trình duyệt dùng Edge headless với backend có guard test và Vite riêng, không tái sử dụng backend không rõ nguồn. Startup timeout 90 giây để bao gồm khởi động/prebundle; không thay assertion nghiệp vụ. GET trong test có thể thử lại một lỗi transport; POST/PATCH không tự retry. Lỗi transport của APIRequestContext trong test được làm gọn để không đưa cookie headers vào báo cáo.

Đã sửa lỗi ID input password trùng giữa hai form forceRender ở trang Người dùng bằng tên form riêng. Không đổi field payload hoặc mutation. Locator Drawer sản phẩm được chỉ rõ tên để phân biệt Modal lồng bên trong.

## Bảo toàn backend và dữ liệu

`src/`, `infra/`, `docs/openapi.json` và `docs/api-client.ts` không bị chỉnh. Không sửa PostgreSQL schema, role/credential, Redis ACL, cookie policy, CSRF, RBAC hoặc stock function. Không truy vấn/ghi main trong nhiệm vụ này. E2E/integration chỉ tạo dữ liệu tổng hợp qua API/test fixture trên test độc lập; không reset database.

Các route/guard và hợp đồng 29 operations giữ nguyên. Ngoại lệ giao diện duy nhất theo phân công là module nhập/xuất chuyển sang trang chờ; không coi module đó đã hoàn thiện chức năng.

## File và artifact

- Theme/shell: `frontend/src/theme.ts`, `main.tsx`, `styles.css`, `layout/AppLayout.tsx`.
- UI chung: `components/Common.tsx`, `components/TrendChart.tsx`.
- JSX trình bày: `pages/DashboardPage.tsx`, `MovementPage.tsx`, `ScanPointsPage.tsx`, `UsersPage.tsx`.
- Các trang Products/Inventory/Transactions/Login nhận style chung; logic API hiện có giữ nguyên.
- Branding/font: `frontend/index.html`, `public/favicon.svg`, `package.json`, `package-lock.json`.
- License font và Swagger được giữ tại `frontend/public/licenses/` và có trong production output.
- Swagger: `frontend/swagger/index.html`, `src/swagger.ts`, `src/swagger.css`, `src/swagger-ui.d.ts`, `vite.config.ts`.
- QA: `frontend/tests/e2e/warehouse.spec.ts`, `frontend/playwright.config.ts`, ảnh tại `frontend/artifacts/`, JSON tại `frontend/test-results/e2e-results.json`.
- Tài liệu: `frontend/README.md`, `docs/AN_FRONTEND_HANDOFF.md`, source tham khảo và báo cáo này; README gốc có liên kết.
- Lệnh chạy chung ở `scripts/dev.js` và package gốc là thay đổi đã thực hiện trong yêu cầu khởi động dự án trước đó, được giữ lại.

## Giới hạn và setup triển khai

- Module nhập/xuất chờ An; hai E2E phụ thuộc form cũ được skip rõ lý do, không báo PASS.
- Swagger read-only; không coi việc xem schema là bằng chứng gọi API thành công.
- Build còn cảnh báo chunk >500 kB cho app Ant Design và Swagger; Swagger là entry riêng, không tải cùng Dashboard. Chưa làm đợt tối ưu bundle ngoài phạm vi thiết kế.
- Cần Docker Desktop và cấu hình test có sẵn để chạy `npm.cmd run dev`. Chạy Playwright khi hai cổng 3000/5173 đang trống.
- Host static cần phục vụ `/swagger/index.html` và assets trước SPA fallback; `/api` cần proxy cùng origin. Triển khai production/main vẫn là việc riêng theo backend readiness.
- Không quan sát được dashboard S-Link trực tiếp vì trang không trả nội dung đọc được và công cụ browser bị dừng. Thiết kế dùng brief của người dùng, không sao chép tài sản của trang tham khảo. Ảnh ứng dụng local được tạo từ Playwright.
