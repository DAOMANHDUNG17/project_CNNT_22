# Smart Warehouse · KT2 trên Postman

## Import và đăng nhập

1. Chạy backend với mã mới, rồi import [collection v2.1](<Smart Warehouse - KT2 API Testing.postman_collection.json>) vào Postman Desktop. Backend mặc định ở `http://localhost:3000`. Kiểm tra Swagger tại `/api/docs` có `POST /api/stock-movements/replay` trước khi dùng chế độ B.
2. Collection sử dụng Bearer `{{vault:kt2AccessToken}}`. Trong Local Vault, bật **Allow Vault secrets in scripts**, giữ **Mask vault secrets** bật và cấp quyền cho collection khi Postman hỏi. [Postman Vault](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-vault)
3. Nếu phiên đã hết hạn, điền `staffEmail`, `supabaseUrl` và `supabasePublicKey` từ cấu hình frontend. Sử dụng publishable key hoặc anon key. Request **00** đăng nhập bằng mật khẩu `kt2StaffPassword` trong Vault và lưu JWT về `kt2AccessToken` trong Vault. [Frontend Auth](../frontend/src/auth/AuthProvider.tsx), [API client](../frontend/src/lib/backend-api.ts)

Cả hai chế độ cần STAFF đang hoạt động và có đúng một phân công điểm quét đang hoạt động. Collection xác minh qua `GET /api/auth/me` và `GET /api/scan-points/my`. Backend tiếp tục xác minh quyền khi nhận POST. Scripts của KT2 nằm ở cấp collection. [AuthGuard](../backend/src/auth/auth.guard.ts), [ScanPointsController](../backend/src/scan-points/scan-points.controller.ts), [StockMovementsService](../backend/src/stock-movements/stock-movements.service.ts)

## A - New Transaction Test

Trong **Collection → Variables**, đặt `productId` và `quantityPackages`. Mặc định là `SP020` và `1`. Số gói nhận từ `1` đến `2147483646` để bước 04 có thể tăng thêm 1.

| Request | HTTP mong đợi | Kiểm tra |
| --- | ---: | --- |
| `01 - GET Inventory` | 200 | Đọc tồn và trạng thái của sản phẩm đã chọn. Lấy đơn vị từ `GET /api/product-units`, ưu tiên đơn vị cơ sở, sau đó theo hệ số nhỏ nhất và mã quét theo thứ tự chữ cái. Lưu mã quét, hệ số, điểm quét, tồn ban đầu và một UUID chưa có trong lịch sử. |
| `02 - POST New Transaction (201)` | 201 | Gửi IN từ snapshot của 01. Kiểm tra `is_duplicate: false` và tồn tăng đúng `quantityPackages × conversion_factor`. |
| `03 - POST Replay Same UUID (200)` | 200 | Gửi cùng UUID và đúng body của 02. Kiểm tra `message`, `is_duplicate: true`, giao dịch gốc, tồn và `updated_at`. |
| `04 - POST UUID Conflict (409)` | 409 | Giữ UUID và dữ liệu gốc, chỉ tăng số gói thêm 1. Kiểm tra thông báo xung đột và tồn, `updated_at`, lịch sử giữ nguyên. |

`scanCode` và `transactionId` là kết quả tự điền. Bước 02–04 đọc snapshot `kt2NewRun`; thay đổi Variables sau 01 chỉ có tác dụng khi chuẩn bị đợt khác. Sau khi 04 đạt, gửi lại 01 để lấy tồn mới và UUID mới. Nếu một POST mất phản hồi hoặc phép đối chiếu thất bại, giữ UUID và dùng PostgreSQL chỉ đọc để xác minh trước khi gửi tiếp. [SQL đối chiếu](KT2_TEST_REPORT.md#sql-đối-chiếu)

## B - Existing UUID Test

Dán UUID cần thử vào **Collection → Variables → existingTransactionId**, rồi gửi 05–07. Đợt B có snapshot riêng `kt2ExistingRun`.

| Request | HTTP mong đợi | Kiểm tra |
| --- | ---: | --- |
| `05 - LOOKUP Existing UUID` | 200 | `GET /api/transactions?transactionId=…&limit=1` hiển thị UUID, sản phẩm, tên sản phẩm, `scan_code_snapshot` là mã quét gốc, điểm quét, IN/OUT, số gói, tồn trước/sau và thời điểm tạo. Script kiểm tra quyền và lấy tồn **hiện tại** của sản phẩm để so sánh sau 06–07. |
| `06 - REPLAY Existing UUID (200)` | 200 | Tạo body từ dòng gốc của 05. Kiểm tra `message`, `is_duplicate: true`, snapshot gốc và tồn hiện tại giữ nguyên. |
| `07 - CONFLICT Existing UUID (409)` | 409 | Giữ dữ liệu gốc, chỉ cộng số gói thêm 1. Kiểm tra xung đột, tồn và `updated_at` giữ nguyên, UUID vẫn có đúng một dòng. |

Chỉ STAFF đã thực hiện giao dịch và còn được phân công đúng điểm quét gốc mới chạy được 06–07. Nếu GET trả `data: []`, **Test Results** báo UUID không tồn tại và chặn cả hai POST. Hai request dùng `POST /api/stock-movements/replay`. Route này trả `404` nếu UUID thiếu lúc POST và dùng lại kiểm tra quyền, đối chiếu nội dung, khóa UUID của backend. Nếu số gói gốc đã bằng `2147483647`, vẫn chạy được 06, còn 07 dừng vì cộng 1 sẽ vượt giới hạn DTO. [Lịch sử giao dịch](../backend/src/transactions/transactions.controller.ts), [Route replay](../backend/src/stock-movements/stock-movements.controller.ts)

## Quay video KT2

Gửi từng request để ghi được màn hình theo thứ tự. Nếu dùng Collection Runner, chọn đúng folder, **1 iteration**, bật **Keep variable values** để giữ UUID và trạng thái. [Postman Collection Runner](https://learning.postman.com/latest-v-12/docs/tests-and-scripts/running-collections/intro-to-collection-runs)

| Cảnh | Nội dung quay | Thời lượng |
| --- | --- | --- |
| A · Chuẩn bị | Hiện `productId`, `quantityPackages`. Gửi 01 và dừng ở Test Results để thấy tồn, mã quét và hệ số. | 8–12 giây |
| A · 201 → 200 → 409 | Gửi 02–04. Ở 02 hiện `inventory_before` và `inventory_after`. Ở 03 hiện thông báo và `is_duplicate: true`. Ở 04 hiện thông báo xung đột và Test Results xác nhận tồn giữ nguyên. | 8–12 giây mỗi request |
| B · Tra cứu | Dán UUID, gửi 05 và hiện dòng giao dịch gốc cùng kết quả xác minh quyền. Có thể dùng UUID vừa tạo ở A nếu vẫn dùng cùng STAFF và điểm quét. | 8–12 giây |
| B · 200 → 409 | Gửi 06–07. Hiện thông báo, `is_duplicate: true` ở 06 và phép kiểm tra tồn cùng số dòng sau cả hai request. | 8–12 giây mỗi request |
| SQL | Khi cần minh chứng trực tiếp, chạy truy vấn chỉ đọc với đúng UUID và sản phẩm, giữ màn hình ở cột tồn, `updated_at` và số dòng. | 8–12 giây |

Chuẩn bị phiên trước khi quay và chỉ mở biến sản phẩm, UUID, snapshot và kết quả KT2 trên màn hình ghi.
