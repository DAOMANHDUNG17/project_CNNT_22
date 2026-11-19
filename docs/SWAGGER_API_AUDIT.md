# Rà soát Swagger API · Smart Warehouse

## Hiện trạng trước chỉnh sửa

Ngày 20/11/2026, tại `http://localhost:3000`, `GET /api/health` trả `200` và `database: connected`, `GET /api/docs` tải HTML với `200` và `GET /api/docs-json` trả OpenAPI 3.0.0 với `200`. Tài liệu có **22 thao tác trên 18 đường dẫn**, 22 operation ID riêng, 9 schema dùng lại và cơ chế bearer JWT. Edge headless xác nhận 10 nhóm và 22 thao tác được mở sẵn. [Ảnh trước chỉnh sửa](swagger-before.png)

| Nhóm trước chỉnh sửa | Số thao tác |
| --- | ---: |
| Auth | 2 |
| Health | 2 |
| Inventory | 1 |
| Products | 3 |
| ProductUnits | 3 |
| ScanPoints | 2 |
| StockMovements | 2 |
| Transactions | 1 |
| Dashboard | 1 |
| Users | 5 |

Nhóm dùng tên controller tiếng Anh. Danh mục sản phẩm và đơn vị đóng gói tách rời, còn phân công điểm quét nằm lẫn trong nhóm quản lý tài khoản. Hai thao tác health chưa có tên nghiệp vụ. POST giao dịch có tài liệu về replay nhưng trình tự KT2 và các kết quả 201, 200, 409 chưa được trình bày liền nhau. Hai endpoint health cùng gọi kiểm tra kết nối PostgreSQL. Hai POST giao dịch có phần replay chung, với mục đích khác nhau là tạo hoặc phát lại và chỉ phát lại.

## Bảng đánh giá trước chỉnh sửa

A là API được frontend gọi. B là nghiệp vụ hoặc quản trị cần giữ. C là API phục vụ kiểm thử. D là chẩn đoán kỹ thuật. E dành cho API cũ hoặc nghi ngờ. Kết quả đối chiếu gồm controller và service NestJS, luồng React, client API, AuthGuard/RolesGuard, các test Jest, Postman và tài liệu QA.

| Method | Endpoint | Chức năng | Nơi sử dụng | Nhóm đề xuất | Hiển thị | Lý do |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/auth/me` | Hồ sơ và vai trò hiện tại | AuthProvider, KT2/KT3, e2e | 01 · A, C | Giữ | Xác nhận phiên và quyền khi kiểm thử. |
| GET | `/api/auth/admin-check` | Thử quyền ADMIN | E2E auth, runbook KT3 | D, C | Ẩn | Probe quyền với response tối thiểu. Runbook và e2e tiếp tục gọi URL trực tiếp. |
| GET | `/api/health` | Tình trạng dịch vụ và PostgreSQL | README, khởi động, QA, e2e | 07 · C, D | Giữ | Kiểm tra sẵn sàng cho mọi lượt demo. |
| GET | `/api/health/database` | Probe riêng kết nối PostgreSQL | E2E health, có thể có monitor gọi trực tiếp | D | Ẩn | Kiểm tra cùng kết nối với health chính. Route chẩn đoán vẫn giữ. |
| GET | `/api/products` | Danh mục sản phẩm | ProductsPage, QA VIEWER, e2e | 02 · A, B | Giữ | Nguồn danh mục cho giao diện. |
| POST | `/api/products` | Khai báo sản phẩm | ProductsPage, e2e | 02 · A, B | Giữ | Nghiệp vụ ADMIN. |
| PATCH | `/api/products/{id}` | Sửa tên hoặc trạng thái | ProductsPage, e2e | 02 · A, B | Giữ | Chỉnh dữ liệu danh mục. |
| GET | `/api/product-units` | Đơn vị, mã quét và hệ số | ProductsPage, MovementPage, Postman KT2 | 02 · A, B, C | Giữ | Chọn mã quét và tính tồn theo quy đổi. |
| POST | `/api/product-units` | Tạo đơn vị và mã quét | ProductsPage, e2e | 02 · A, B | Giữ | Khai báo đóng gói. |
| PATCH | `/api/product-units/{id}` | Sửa đơn vị sản phẩm | ProductsPage, e2e | 02 · A, B | Giữ | Bảo trì đơn vị và hệ số. |
| GET | `/api/inventory` | Tồn theo sản phẩm | InventoryPage, luồng nhập/xuất, KT1/KT2/KT3 | 03 · A, B, C | Giữ | Số liệu dùng để đối chiếu trước và sau. |
| GET | `/api/dashboard` | Tổng quan kho, xu hướng và tồn thấp | DashboardPage, e2e, QA VIEWER | 03 · A, B | Giữ | Đọc các chỉ số tổng hợp. |
| POST | `/api/stock-movements` | Nhập/xuất hoặc replay đúng UUID | MovementPage, StockOutPanel, Kt2Panel, KT1/KT2 | 04 · A, B, C | Giữ | Endpoint chính cho demo 201, 200 và 409. |
| POST | `/api/stock-movements/replay` | Chỉ phát lại giao dịch đã có | Postman KT2 hai chế độ và Simple Demo, e2e | 04 · C | Giữ | Workflow tra UUID cũ phụ thuộc vào hành vi 404 khi UUID thiếu. |
| GET | `/api/transactions` | Lịch sử và tra cứu chính xác UUID | TransactionsPage, Kt2Panel, Postman, KT3 | 05 · A, B, C | Giữ | Nguồn đối chiếu lịch sử và số bản ghi. |
| GET | `/api/scan-points` | Danh mục điểm quét | ScanPointsPage, quản trị phân công, e2e | 06 · A, B | Giữ | Chọn và kiểm tra điểm quét. |
| GET | `/api/scan-points/my` | Điểm quét được cấp cho phiên hiện tại | MovementPage, Postman, KT3, e2e | 06 · A, B, C | Giữ | Kiểm tra phiên STAFF trước khi demo. |
| GET | `/api/users/{id}/scan-points` | Xem lịch sử phân công của tài khoản | UsersPage, QA scan-point-access | 06 · A, B | Giữ | Xem phân công có và đã thu hồi. |
| PUT | `/api/users/{id}/scan-points` | Thay danh sách phân công | UsersPage, QA scan-point-access | 06 · A, B | Giữ | Quản trị phân công ADMIN. |
| GET | `/api/users` | Danh sách tài khoản | UsersPage, e2e, QA VIEWER kiểm tra 403 | 07 · A, B | Giữ | Quản lý quyền và trạng thái tài khoản. |
| POST | `/api/users` | Tạo tài khoản Auth và hồ sơ kho | UsersPage, e2e | 07 · A, B | Giữ | Cấp tài khoản ADMIN, STAFF hoặc VIEWER. |
| PATCH | `/api/users/{id}` | Sửa hồ sơ, vai trò hoặc trạng thái | UsersPage, e2e | 07 · A, B | Giữ | Quản trị tài khoản và bảo vệ ADMIN cuối cùng. |

Chưa xác định API runtime nào thuộc E. Tài liệu tĩnh `docs/openapi.json` là tài liệu tham khảo cũ, được trang Swagger tĩnh của frontend đọc riêng. Phạm vi chỉnh sửa là Swagger được NestJS sinh ở `/api/docs` và `/api/docs-json`.

## Kết quả sau chỉnh sửa

| Chỉ số | Trước | Sau |
| --- | ---: | ---: |
| Thao tác trong OpenAPI chính | 22 | 20 |
| Đường dẫn trong OpenAPI chính | 18 | 16 |
| Nhóm Swagger | 10 | 7 |
| Schema trong OpenAPI | 9 | 9 |

| Nhóm mới | Số thao tác |
| --- | ---: |
| 01 — Xác thực & tài khoản | 1 |
| 02 — Danh mục sản phẩm | 6 |
| 03 — Quản lý tồn kho | 2 |
| 04 — Nhập / xuất kho | 2 |
| 05 — Lịch sử giao dịch | 1 |
| 06 — Điểm quét & phân công | 4 |
| 07 — Quản trị hệ thống | 4 |

Các nhóm mặc định thu gọn, có ô lọc theo nhóm hoặc đường dẫn và giữ nút **Authorize**. Phần Models/Schemas ở cuối trang được ẩn, schema vẫn có trong JSON và từng thao tác. 20 thao tác được giữ trong bảng đánh giá ở trên. Hai probe đánh dấu ẩn vẫn phục vụ tại URL cũ. Swagger của POST nhập/xuất chính có ví dụ body và hướng dẫn 201 → 200 → 409. [Ảnh sau chỉnh sửa, lấy trên QA](swagger-after.png) · [Hướng dẫn KT2](KT2_SWAGGER_GUIDE.md)

Các tích hợp dùng `/api/health/database` có thể tiếp tục gọi trực tiếp. E2E và runbook KT3 tiếp tục kiểm tra `/api/auth/admin-check`. Giữ `/api/stock-movements/replay` vì các collection KT2 vẫn dùng. Với tài liệu tĩnh của frontend, tiếp tục rà nguồn sử dụng trước mọi quyết định dọn dẹp.

## Kiểm thử

| Kiểm tra | Kết quả |
| --- | --- |
| Build và unit backend | Build thành công, 20 unit test đạt. |
| Backend e2e và PostgreSQL 17 QA | 332 test đạt, gồm KT1, KT2 201/200/409 và KT3 VIEWER. Hai probe vẫn trả đúng 200 hoặc 401/403 tùy quyền. |
| OpenAPI runtime | JSON hợp lệ theo schema OpenAPI 3.0. Đối chiếu cùng method, operation ID, bộ tham số, schema request và security schemes của 20 thao tác giữ lại. |
| Swagger UI QA | Edge headless tải giao diện, xác nhận bảy nhóm thu gọn, bộ lọc theo tên và path, nút Authorize, ví dụ KT2 và Try it out với GET health. Truy vấn hướng dẫn chạy được trên PostgreSQL QA. |
| Frontend | Typecheck và 64 unit test đạt. Một ca LAN/HMR cần cổng 5173 trống và được bỏ qua vì frontend đang dùng cổng này. |
| Tiến trình cổng 3000 | Giữ nguyên phiên bản đang chạy. Công cụ tự động chặn lệnh thay tiến trình đã xác minh. Bản mới được xác nhận trên NestJS riêng với PostgreSQL QA. |

Ảnh trước chụp từ tiến trình cổng 3000, ảnh sau chụp từ bản build trên QA. Các thao tác ghi của kiểm thử chỉ chạy với mock hoặc PostgreSQL QA.

## File backend cập nhật

- [api-docs.ts](../backend/src/api-docs.ts) và [main.ts](../backend/src/main.ts) cấu hình Swagger và thứ tự nhóm.
- Metadata tài liệu trong mười controller: [auth](../backend/src/auth/auth.controller.ts), [health](../backend/src/health/health.controller.ts), [products](../backend/src/products/products.controller.ts), [product units](../backend/src/product-units/product-units.controller.ts), [inventory](../backend/src/inventory/inventory.controller.ts), [dashboard](../backend/src/dashboard/dashboard.controller.ts), [stock movements](../backend/src/stock-movements/stock-movements.controller.ts), [transactions](../backend/src/transactions/transactions.controller.ts), [scan points](../backend/src/scan-points/scan-points.controller.ts) và [users](../backend/src/users/users.controller.ts).
- [app.e2e-spec.ts](../backend/test/app.e2e-spec.ts) kiểm tra nhóm, endpoint bị ẩn và ví dụ KT2.
