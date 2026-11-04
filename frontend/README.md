# Smart Warehouse frontend

React + TypeScript strict + Vite + Ant Design. Premium Red Enterprise UI, Be Vietnam Pro local, REST client hiện có và Redis Session qua same-origin `/api`.

## Chạy ứng dụng

Node >=24.7. Cài từ thư mục gốc rồi mở Docker Desktop:

```powershell
Set-Location D:\Project_CNNT
npm.cmd ci
npm.cmd --prefix frontend ci
npm.cmd run dev
```

- Frontend: http://127.0.0.1:5173
- Backend test: http://127.0.0.1:3000
- Swagger: http://127.0.0.1:5173/swagger/
- Bàn giao An: http://127.0.0.1:5173/stock-movement

Lệnh gốc `dev` chọn cấu hình test local, bật PostgreSQL/Redis bằng Compose, đợi backend healthy rồi chạy Vite. Không bootstrap/reset database. `Ctrl+C` dừng hai server; container vẫn chạy. Cài đặt test lần đầu xem README gốc. Không dùng database chính cho CRUD/integration.

Chạy riêng frontend: `npm.cmd --prefix frontend run dev`. Backend riêng: chọn `APP_ENV_FILE` trỏ `infra/phase3/local/backend.env`, rồi `npm.cmd run dev:backend`. Không để biến PG/Redis cũ ghi đè cấu hình khi chạy riêng.

## Phạm vi và thiết kế

- Giữ các route hiện có, client, AuthProvider, guard và REST contract.
- Thiết kế lại Login, Dashboard, Products & Units, Inventory, Transactions, Scan Points và Users qua theme, CSS và các component dùng chung.
- `theme.ts` là nguồn màu cho Ant Design và CSS variables `--sw-*`.
- Primary `#B42332`, sidebar `#831C28` / `#661520`, nền `#F6F7F9`, card trắng, border `#E5E7EB`.
- Font Be Vietnam Pro 400/500/600/700 được đóng gói local bằng `@fontsource/be-vietnam-pro`, kèm font fallback Inter/Arial/sans-serif. Giấy phép font OFL cùng license/NOTICE Swagger có tại `public/licenses/` và được đưa vào build; không phụ thuộc CDN khi chạy.
- Card 16px, input/button khoảng 42px, page padding 32px desktop / 16px mobile, semantic success/warning/error riêng.
- Sidebar trắng 248px, mục chọn nền xám nhẹ/chữ đỏ, Drawer mobile cùng phong cách; mục đầu là icon ngôi nhà và tên **Trang chủ**. Header chỉ giữ breadcrumb và tài khoản, đã bỏ pill database. Tiêu đề trang không còn eyebrow hoặc đoạn mô tả phụ; sidebar bỏ các dòng ghi chú và khối giới thiệu cuối cột.
- Số bigint giữ string; inventory totals tách theo base_unit. Chart vẫn là SVG/trend từ API thực, có title tooltip và bảng số liệu chính xác.
- Bảng chỉ cuộn ngang trong container; focus bàn phím và reduced motion được hỗ trợ.

## Module An

`/stock-movement` là trang **Đợi An phát triển** theo phân công, không gửi giao dịch hoặc mở camera. Menu và guard ADMIN/KEEPER/STAFF giữ nguyên. Xem [tài liệu bàn giao](../docs/AN_FRONTEND_HANDOFF.md) về endpoint thực, UUID/pending/retry, CSRF, RBAC và nhiệm vụ còn lại.

Source cũ tham khảo: `docs/reference/MovementPage.before-handoff.tsx`. Các helper nghiệp vụ `lib/pendingMovement.ts`, `lib/api.ts` và unit test được giữ, không đổi semantics idempotency. Hai E2E phụ thuộc form cũ chờ An khôi phục; không tính là PASS.

## Swagger

Đây là entry HTML tài liệu riêng `/swagger/`, không thêm route ứng dụng/sidebar hoặc endpoint Express. Dùng `swagger-ui-dist`, tắt `Try it out`, không lưu authorization, không gọi validator bên ngoài. Thử API trong frontend qua typed client và cookie/CSRF hiện có, chỉ ghi trên PostgreSQL test.

Vite plugin phục vụ và đóng gói nguyên bản `docs/openapi.json` cùng `docs/AN_FRONTEND_HANDOFF.md`. Chỉnh hai file nguồn này để cập nhật tài liệu, không sửa bản `dist/swagger/`.

Build bằng `npm.cmd --prefix frontend run build`; output gồm `dist/index.html`, `dist/swagger/index.html`, tài liệu và assets. Static host cần phục vụ `/swagger/` bằng đúng `swagger/index.html` trước khi áp SPA fallback cho route ứng dụng. Proxy `/api` giữ Origin, cookie cùng origin; production HTTPS/credential triển khai riêng theo backend readiness.

## Kiểm thử

```powershell
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend test
# Dừng dev server trước; test tự mở backend có guard test và Vite:
npm.cmd --prefix frontend run test:e2e
```

Playwright dùng Edge đã cài (`channel: msedge`). E2E tạo dữ liệu tổng hợp qua API trên test, không reset DB; ảnh không chứa mật khẩu/token ở `frontend/artifacts/`, kết quả JSON ở `frontend/test-results/e2e-results.json`. Không bật trace/storageState chứa credential. Trạng thái nghiệm thu cuối tại [FRONTEND_READINESS.md](../FRONTEND_READINESS.md).

## Changelog

- Đồng bộ màu đỏ, font tiếng Việt local, card/bảng/tag/form/modal/drawer.
- Cân lại KPI, analytics và operations trên Dashboard, giữ dữ liệu và truy vấn hiện có.
- Cập nhật branding/Login và các trạng thái responsive.
- Đặt trang nhập/xuất chờ An, lưu source cũ tham khảo và cập nhật link từ Dashboard/Điểm quét.
- Thêm Swagger read-only và báo cáo bàn giao; backend, schema, Redis ACL và hợp đồng API không đổi.
