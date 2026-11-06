# Bàn giao frontend nhập/xuất kho cho An

> Tài liệu tham khảo của hệ thống cũ. API contract trong tài liệu này không ràng buộc backend mới.

Ngày bàn giao: 05/11/2026 (Asia/Bangkok).

## 1. Phân công và trạng thái

| Thành viên | Phạm vi |
| --- | --- |
| Dũng | Backend, PostgreSQL, Redis, API và tích hợp |
| An | Frontend quét mã, nhập/xuất kho |
| Nam | Hạ tầng mạng |
| Vy | Kiểm thử và nghiệm thu |

Backend có 29 HTTP operations theo `docs/openapi.json`; xem bằng chứng tại `BACKEND_READINESS.md`. Chỉ môi trường test độc lập đã được nghiệm thu. Database chính chưa sẵn sàng cho backend Auth/Admin mới.

Route `/stock-movement` hiện là trang thông báo **Đợi An phát triển**, không có form hoặc nút gửi giao dịch. Route, sidebar và guard ADMIN/KEEPER/STAFF được giữ nguyên; VIEWER không có quyền vào module. Dashboard và Điểm quét dẫn tới trang thông báo, không khẳng định module đã hoàn thiện.

Source giao diện nhập/xuất trước bàn giao được lưu nguyên bản tại `docs/reference/MovementPage.before-handoff.tsx`. Đây là tài liệu tham khảo, không được import vào ứng dụng và không được biên dịch ở vị trí này. Các import tương đối trong file hướng tới vị trí gốc `frontend/src/pages/MovementPage.tsx`. An có thể tham khảo các nhánh pending/retry; cần kiểm thử lại khi tích hợp UI mới.

## 2. Kiến trúc và nguyên tắc tích hợp

```text
React + TypeScript + Ant Design (127.0.0.1:5173)
  -> same-origin /api, Vite proxy giữ nguyên Origin
  -> Express (127.0.0.1:3000)
       -> Redis: session opaque, CSRF và rate limit
       -> PostgreSQL test (127.0.0.1:5433)
            reader: warehouse_readonly
            writer: warehouse_backend -> stock/admin functions
```

Browser tự quản lý HttpOnly cookie. Không lưu cookie/session token/password/CSRF vào localStorage hoặc sessionStorage. Client giữ CSRF trong bộ nhớ. `scan_point_id` là điểm ghi nhận nghiệp vụ, không xác thực thiết bị vật lý. Mỗi máy/trình duyệt phải đăng nhập bằng tài khoản hợp lệ; hai phiên độc lập có thể sử dụng SCAN01 và SCAN02.

Không sửa database chính, schema, role, stock function, Redis ACL, cookie, CSRF hay RBAC để làm giao diện hoạt động.

## 3. Chạy dự án trên môi trường test đã có

Yêu cầu Node >=24.7, npm và Docker Desktop. Không chạy lại bootstrap trên database test đang có.

```powershell
Set-Location D:\Project_CNNT
npm.cmd ci
npm.cmd --prefix frontend ci
# Mở Docker Desktop trước:
npm.cmd run dev
```

Lệnh chung bật hai container test, chọn `infra/phase3/local/backend.env`, đợi backend health và chạy Vite. Trang ứng dụng: http://127.0.0.1:5173. Dừng hai server bằng Ctrl+C; container vẫn chạy. Dùng `npm.cmd` khi PowerShell chặn `npm.ps1`.

Nếu chạy riêng backend:

```powershell
Set-Location D:\Project_CNNT
docker compose --env-file infra/phase3/local/compose.env -f infra/phase3/compose.review.yaml up -d --wait
$env:APP_ENV_FILE = (Resolve-Path 'infra/phase3/local/backend.env').Path
npm.cmd run dev:backend
```

Terminal frontend riêng: `npm.cmd --prefix frontend run dev` từ thư mục gốc. Với cách chạy riêng, tránh biến PG/Redis cũ trong terminal ghi đè file test. Cấu hình phải là 127.0.0.1:5433 / smart_warehouse_phase3_test, không phải cổng 5432. Máy mới chưa có cấu hình phải làm theo README gốc; không tự reset môi trường.

Tài khoản fixture là `p3_admin`, `p3_keeper`, `p3_staff`, `p3_viewer`. Người có quyền đọc secret local lấy mật khẩu từ file tương ứng trong `infra/phase3/local/`; không đưa giá trị vào source, ảnh chụp hoặc tài liệu. Giữ hostname 127.0.0.1 nhất quán để cookie/proxy đúng origin.

## 4. Swagger và nguồn hợp đồng

- Swagger UI: http://127.0.0.1:5173/swagger/
- JSON gốc được phục vụ tại: http://127.0.0.1:5173/swagger/openapi.json
- Bản bàn giao này: http://127.0.0.1:5173/swagger/AN_FRONTEND_HANDOFF.md
- Nguồn duy nhất: `docs/openapi.json`; typed client: `docs/api-client.ts`.

Swagger hiển thị đủ 29 operations, tham số, body, response và HTTP status. Vite phục vụ trực tiếp tài liệu nguồn khi dev và đóng gói cùng nội dung khi build. Không tạo endpoint backend mới.

Swagger ở chế độ tra cứu, tắt **Try it out** cho mọi method; không phải công cụ gửi giao dịch hoặc đăng nhập. Không gửi đặc tả tới validator bên ngoài. Dùng typed client trong ứng dụng đã đăng nhập để thử API, client tự gửi cookie và lấy CSRF. Không tắt bảo mật để bật Swagger. Chỉ thử ghi trên môi trường test độc lập.

## 5. API liên quan tới module của An

| API | Typed client | Mục đích / lưu ý |
| --- | --- | --- |
| POST /api/auth/login | login(username, password) | Đăng nhập, cookie do browser quản lý |
| GET /api/auth/me | me() | Khôi phục phiên và role hiện tại |
| GET /api/auth/csrf | csrf() | Token gắn với phiên; client tự lấy trước lần ghi đầu tiên |
| POST /api/auth/logout | logout() | Đăng xuất, thu hồi phiên |
| GET /api/scan-points | listScanPoints({page, limit}) | Danh sách điểm; chọn is_active=true |
| GET /api/products | listProducts({q, page, limit}) | Tìm mã/tên sản phẩm; không hỗ trợ lọc trạng thái server |
| GET /api/products/{id} | getProduct(id) | Chi tiết sản phẩm và units: mã quét, factor, base unit |
| GET /api/inventory/{productId} | getInventory(productId) | Tồn hiện tại theo đơn vị cơ sở |
| GET /api/inventory | listInventory({page, limit}) | Danh sách tồn; không có q trong hợp đồng |
| GET /api/inventory/low-stock | lowStock({threshold, q, page, limit}) | Ngưỡng so sánh nghiêm ngặt quantity_base < threshold |
| GET /api/transactions | listTransactions({productId, movementType, scanPointId, page, limit}) | Lịch sử, lọc mã sản phẩm chính xác / IN-OUT / điểm quét |
| GET /api/transactions/{id} | getTransaction(id) | Chi tiết và snapshot tồn sau giao dịch |
| POST /api/transactions | recordTransaction(payload) | Ghi nhận nghiệp vụ nhập/xuất |

Không có endpoint lookup sản phẩm trực tiếp bằng barcode, camera API, USB API hoặc endpoint xác thực thiết bị. Đừng tự gọi `/scan`, `/barcode`, `/products/by-code`. Nếu cần preview sản phẩm, lấy danh mục/chi tiết theo API thực có; không giả định q tìm được mã quét đơn vị. Backend sẽ giải mã `scan_code` khi ghi giao dịch. Muốn endpoint mới cần thống nhất riêng với Dũng.

Danh sách phân trang dùng `pagination.total`, không dùng `count` làm tổng. `count` là số hàng trong trang. Với điểm quét, dùng `allPages` sẵn có nếu cần đủ các trang, sau đó lấy các điểm đang hoạt động; không tuyên bố `is_active` chứng minh thiết bị online.

Tồn và tổng hợp bigint là **string**, giữ chính xác bằng `integer()` hoặc BigInt, không chuyển sang Number. Số gói và conversion_factor là integer 1..2147483647. Không cộng tồn có base_unit khác loại. `inventory_after` là snapshot lịch sử, không phải tồn hiện tại; bản ghi thiếu inventory không đồng nghĩa tồn bằng 0. Timestamps lưu UTC và giao diện hiện hiển thị UTC+7; truy vấn dashboard theo ngày UTC. Lịch sử giao dịch không hỗ trợ date-range filter server trong hợp đồng hiện tại.

## 6. Quy trình giao diện An cần xây

1. Dùng `useAuth()` và guard hiện có, khôi phục phiên qua `/auth/me`.
2. Tải điểm quét và áp `?station=SCAN01` khi đó là điểm hợp lệ; giữ lựa chọn là dữ liệu nghiệp vụ.
3. Chọn IN/OUT theo quyền. KEEPER/ADMIN nhập và xuất, STAFF chỉ xuất, VIEWER không ghi.
4. Nhận mã từ bàn phím/máy quét dạng keyboard wedge hoặc nhập thủ công; hỗ trợ Enter và focus hợp lý. Không triển khai native USB protocol.
5. Kiểm tra số lượng gói, mã và điểm quét; cho người dùng xem lại/xác nhận nghiệp vụ.
6. Chỉ sau xác nhận, sinh một UUID v4 bằng `crypto.randomUUID()` và đóng băng payload.
7. Lưu pending trước HTTP, theo tab và userId; chỉ lưu dữ liệu nghiệp vụ, không lưu secret/token.
8. Gọi `api.recordTransaction(payload)` một lần. Khóa double-submit khi đang gửi.
9. Hiển thị CREATED/DUPLICATE hoặc lỗi; khi chưa rõ kết quả giữ nguyên pending, không tạo UUID thay thế.
10. Sau khi kết quả đã rõ mới cho phép chuyển sang nghiệp vụ mới.

Camera chưa nằm trong phạm vi bàn giao hiện tại. Nếu nhóm triển khai sau, phải được thống nhất riêng về thư viện, user gesture, HTTPS và cleanup camera; không coi HTTP LAN trên điện thoại là secure context.

## 7. POST /api/transactions và UUID

Request chỉ có 5 trường sau; không thêm actor/user_id/role hoặc tự gửi conversion factor:

```ts
import { api, movementDeadline } from '../lib/api';
import type { MovementRequest } from '../lib/api';
import { savePending } from '../lib/pendingMovement';

// Chỉ chạy sau khi form hợp lệ và người dùng xác nhận.
const payload: MovementRequest = {
  transaction_id: crypto.randomUUID(),
  scan_point_id: values.scan_point_id,
  scan_code: values.scan_code,
  movement_type: movement, // 'IN' | 'OUT', theo role
  quantity_packages: values.quantity_packages,
};
const pending = { createdAt: new Date().toISOString(), payload };
savePending(user.user_id, pending); // Nếu lưu thất bại, chưa gửi HTTP.
const result = await movementDeadline(api.recordTransaction(pending.payload));
// Retry có chủ ý: dùng lại pending.payload, tuyệt đối không sinh UUID mới.
```

Đây là đoạn hướng dẫn cho component của An, không phải một chương trình độc lập: `values`, `movement`, `user` đến từ form và auth thực. `api` trong frontend bọc typed `WarehouseApi('/api')` để xử lý 401; nên dùng wrapper này thay vì nhân bản fetch. Nếu dùng trực tiếp class từ docs, vẫn phải dùng `/api` cùng origin và xử lý 401 đúng luồng.

| Kết quả | Xử lý giao diện |
| --- | --- |
| HTTP 201 / meta.result_status=CREATED | Đã ghi một nghiệp vụ; hiển thị kết quả và snapshot |
| HTTP 200 / DUPLICATE | UUID/payload đã ghi trước đó; xác nhận kết quả cũ, không thêm giao dịch |
| 409 INSUFFICIENT_INVENTORY | Không đủ tồn, không tự retry; cho sửa thành nghiệp vụ mới sau khi xác nhận lỗi đã rõ |
| 409 IDEMPOTENCY_CONFLICT | UUID gắn với payload khác; giữ thông tin để đối chiếu, không đổi UUID để lách |
| 409 IDEMPOTENCY_LEGACY_RECORD | Bản ghi lịch sử không hỗ trợ replay; đối chiếu với Dũng |
| 422 INVALID_SCAN_CODE / INVALID_SCAN_POINT / PRODUCT_INACTIVE | Hiển thị lỗi mã/điểm/sản phẩm từ server |
| 400 INVALID_BODY | Sửa dữ liệu form theo validation |
| 401 AUTHENTICATION_REQUIRED | Đăng nhập lại cùng tài khoản rồi kiểm tra pending; không tự gửi nền |
| 403 FORBIDDEN | Không đủ quyền; server là nguồn quyết định |
| 403 CSRF_FAILED | Làm mới token có chủ ý bằng api.csrf(); retry vẫn giữ UUID/payload |
| 429 | Tôn trọng Retry-After |
| 503 TRANSACTION_OUTCOME_UNKNOWN / timeout / mất mạng / lỗi 5xx | Chưa biết commit hay rollback; giữ UUID/payload, cho kiểm tra lại cùng yêu cầu |

`docs/api-client.ts` không tự retry ghi. `movementDeadline` không hủy một commit đã diễn ra và không chứng minh rollback. Không dùng refresh, reload, response bị mất hoặc đổi điểm quét làm lý do sinh UUID mới cho cùng nghiệp vụ. `sessionStorage` pending giữ riêng từng tab/user, không phải session đăng nhập. Hai UUID khác nhau được xem là hai nghiệp vụ, kể cả payload giống nhau.

## 8. Các file và UI dùng lại

- `frontend/src/pages/MovementPage.tsx`: vị trí An thay trang chờ bằng UI mới.
- `frontend/src/App.tsx`: route và guard; giữ nguyên quyền.
- `frontend/src/lib/api.ts`, `docs/api-client.ts`: client và xử lý auth/deadline.
- `frontend/src/lib/pendingMovement.ts`: parse/load/save pending theo tab/user.
- `frontend/src/auth/AuthProvider.tsx`: user/role, login/logout/session restore.
- `frontend/src/components/Common.tsx`: PageHeading, PanelTitle, ErrorNotice, ExactNumber, MovementTag, IdText, DataTable.
- `frontend/src/theme.ts`, `frontend/src/styles.css`: Premium Red Enterprise design tokens, Be Vietnam Pro local, responsive shell.
- `frontend/src/pages/ScanPointsPage.tsx`: link `?station=...`; trạng thái administrative.

Không sửa các trang còn lại, client, backend hoặc contract tùy tiện. Đổi đơn vị lịch sử/factor/scan code bị backend giới hạn; dùng đơn vị và mã mới khi cần đổi ý nghĩa. User ADMIN cuối cùng không được hạ quyền/khóa. Các lỗi này là hành vi nghiệp vụ cần giữ.

## 9. Tiêu chí An và Vy cần nghiệm thu

- Keyboard/manual scan, chọn station hợp lệ, validation và chống double-submit.
- IN rồi OUT thật; đủ/thiếu tồn và mã không hợp lệ.
- CREATED và replay DUPLICATE không ghi thêm.
- Mất response sau commit, reload và retry giữ nguyên UUID/payload.
- Hai phiên riêng tại hai điểm cùng xuất không gây tồn âm.
- STAFF không nhập; VIEWER không ghi; server tiếp tục từ chối hành vi trái quyền.
- Phiên hết hạn, CSRF lỗi, mất Redis/backend, 429 và các trạng thái lỗi/empty/loading.
- Mobile 390px, tablet 768px, desktop 1440px; focus bàn phím và không tràn toàn trang.
- Typecheck, build, unit, Playwright và kiểm thử backend test độc lập.

```powershell
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend test
# Dừng npm run dev trước vì Playwright tự khởi động hai server test riêng.
npm.cmd --prefix frontend run test:e2e
# Regression backend giữ nguyên:
npm.cmd test
npm.cmd run test:integration
```

Các E2E phụ thuộc form cũ được đánh dấu pending/skipped có lý do chờ An; không coi là PASS cho module nhập/xuất. Test backend/security/UUID thuần vẫn được giữ. Sau khi hoàn thiện UI, An/Vy khôi phục các kịch bản trình duyệt tương ứng rồi chạy trên test; không xóa các kiểm thử bảo mật để đạt số xanh.
