# Hướng dẫn từng bước · SMART WAREHOUSE — KT2 SIMPLE DEMO

## A. Chuẩn bị backend và Postman

1. Mở PowerShell, vào thư mục backend và khởi động từ mã hiện tại. Dùng cấu hình của môi trường bạn định kiểm thử. Có thể dùng PostgreSQL QA đã được cấp nếu muốn làm thử trước khi quay. [Cấu hình dự án](../README.md)

   ```powershell
   Set-Location 'D:\Project_CNNT\backend'
   npm.cmd run start:dev
   ```

2. Mở `http://localhost:3000/api/health`. API sẵn sàng khi trả HTTP `200` và JSON có `"database": "connected"`. Mở tiếp `http://localhost:3000/api/docs` và tìm `POST /api/stock-movements/replay`. Nếu health thành công mà Swagger thiếu route này, quay lại cửa sổ đang chạy backend cũ, nhấn **Ctrl+C** rồi chạy lệnh trên. Nếu dùng cổng khác, điền URL tương ứng vào `baseUrl`.
3. Trong **Postman Desktop**, chọn **Import → Files**, mở [SMART WAREHOUSE - KT2 SIMPLE DEMO.postman_collection.json](<SMART WAREHOUSE - KT2 SIMPLE DEMO.postman_collection.json>). Trong thanh **Collections**, mở **SMART WAREHOUSE — KT2 SIMPLE DEMO**. Bản mới chỉ có 01, 02 và 03. [Nhập collection trong Postman](https://learning.postman.com/docs/getting-started/importing-and-exporting/importing-and-exporting-overview/)
4. Ở **Authorization** của collection, kiểm tra **Bearer Token** có giá trị `{{vault:kt2AccessToken}}`. Ba request kế thừa Authorization này. Mở **Vault → Settings**, bật **Allow Vault secrets in scripts**. Khi gửi request lần đầu và Postman hỏi quyền, cấp quyền cho collection mới. Giữ chế độ che giá trị secret. [Dùng Local Vault trong scripts](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-vault)
5. Nếu chưa có phiên STAFF hoặc bị `401`, mở request **00 - Login STAFF (Supabase Auth)** trong [collection KT2 cũ](<Smart Warehouse - KT2 API Testing.postman_collection.json>). Điền `supabaseUrl`, `supabasePublicKey` và `staffEmail` từ cấu hình môi trường của bạn. Mật khẩu nằm trong secret `kt2StaffPassword` của Local Vault. Nhấn **Send** và chờ HTTP `200`; request 00 lưu access token vào `kt2AccessToken`. Sau đó quay lại collection mới. [Hướng dẫn đăng nhập 00](KT2_POSTMAN.md#import-và-đăng-nhập)

Phiên phải là STAFF đang hoạt động, có đúng một phân công điểm quét đang hoạt động. Với 02–03, dùng đúng STAFF đã tạo giao dịch và vẫn được phân công tại điểm quét gốc.

## B. Bước 01 — Tạo giao dịch mới

1. Chọn tên **SMART WAREHOUSE — KT2 SIMPLE DEMO**, rồi mở tab **Variables**.
2. Điền các biến sau. Bạn có thể lấy mã quét từ danh mục **Đơn vị sản phẩm** trên frontend.

   | Biến | Giá trị nhập |
   | --- | --- |
   | `baseUrl` | URL backend, mặc định `http://localhost:3000`. |
   | `scanCode` | Mã quét có thật của đơn vị sản phẩm muốn kiểm thử. |
   | `quantityPackages` | Số gói nguyên dương. Hệ số quy đổi lấy theo mã quét từ backend. |
   | `movementType` | `IN` khi nhập hoặc `OUT` khi xuất. |
   | `scanPointId` | Điểm quét được phân công, ví dụ `SCAN-01`. Để trống để dùng điểm hiện tại của STAFF. |
   | `transactionId` | Để trống để sinh UUID v4, hoặc nhập một UUID mới theo ý bạn. |

3. Mở **01 — CREATE NEW TRANSACTION (201)** và nhấn **Send**. Nếu ô UUID trống, script lưu một UUID vào biến ngay khi chuẩn bị lượt gửi. Khi nhấn lại 01 với UUID đã tạo thành công, script phát hiện UUID đã có và chặn POST. `_kt2LastReplayId` là biến nội bộ.
4. Xem **201 Created** trên thanh trạng thái response. Trong **Body → Pretty**, xem thông báo, `is_duplicate: false`, `data.transaction_id`, mã quét, số gói, hệ số, `inventory_before` và `inventory_after`. Sang **Test Results** để kiểm tra phép tính tồn và số dòng theo UUID.

## C. Bước 02 — Tra cứu và phát lại UUID

1. Giữ UUID từ 01 hoặc sao chép `transaction_id` của một giao dịch đã lưu do STAFF hiện tại thực hiện. Dán vào **Collection → Variables → transactionId**.
2. Mở **02 — CHECK & REPLAY UUID (200)**, nhấn **Send**. Script tra UUID trong lịch sử của điểm quét đang được phân công, rồi lấy lại mã quét, điểm quét, IN/OUT và số gói gốc. Những ô sản phẩm và số gói dùng cho 01 có thể đang chứa giá trị khác.
3. Trong **Body → Pretty**, xem HTTP **200 OK**, thông báo **Giao dịch đã được xử lý trước đó**, `is_duplicate: true` và chi tiết giao dịch gốc trong `data`.
4. Trong **Test Results**, xem **Không ghi trùng giao dịch**, **Tìm thấy UUID đã tồn tại** và **Tồn kho không cập nhật lần hai**. Nếu giao dịch đã cũ, số tồn hiện tại có thể khác `inventory_after` của giao dịch. Script dùng tồn ngay trước 02 để đối chiếu.

## D. Bước 03 — Kiểm thử xung đột 409

1. Giữ nguyên `transactionId` của lần 02 vừa đạt. Mở **03 — MODIFY SAME UUID — REJECT (409)**.
2. Nhấn **Send**. Script tự lấy body gốc và tăng `quantity_packages` thêm 1. Ở giới hạn tối đa của DTO, script giảm 1 để tạo một giá trị hợp lệ khác. Số gói nhập trong Variables vẫn dành cho 01.
3. Xem **409 Conflict** và thông báo **Mã giao dịch đã được dùng cho một lượt nhập/xuất khác.** Trong **Test Results**, xem **Từ chối thay đổi nội dung giao dịch đã lưu** và xác nhận tồn, timestamp, bản ghi giữ nguyên bằng SQL bên dưới.

| Tình huống | Xử lý |
| --- | --- |
| HTTP `401` hoặc thiếu secret Vault | Cấp quyền Vault cho collection, rồi làm mới phiên bằng 00 khi cần. |
| HTTP `403` hoặc thông báo thiếu phân công | Kiểm tra role STAFF, phân công hiện tại và điểm quét gốc của giao dịch. |
| UUID thiếu, sai định dạng hoặc thuộc giao dịch của người khác | Kiểm tra lại `transactionId` và tài khoản. Nếu không tìm thấy giao dịch, script chặn POST và ghi lý do trong Test Results hoặc Postman Console. |
| Mã quét hoặc số gói không hợp lệ, tồn OUT không đủ | Chỉnh đầu vào cho 01 theo thông báo lỗi. Giữ UUID của lượt đang kiểm tra. |
| 03 báo chưa có replay đạt | Gửi 02 với đúng UUID hiện tại trước. |
| Backend chạy phiên bản cũ | Kiểm tra Swagger có route replay rồi khởi động lại từ mã hiện tại. |

## E. SQL đối chiếu chỉ đọc

Trong SQL Editor của môi trường kiểm thử, thay hai giá trị của dòng `VALUES` bằng UUID và mã quét thực tế. Chạy truy vấn trước 01 nếu đã biết UUID, sau 01 và sau từng bước 02–03. Với UUID cũ, chụp kết quả trước 02 để lấy mốc tồn hiện tại.

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH input(transaction_id, scan_code) AS (
  VALUES ('00000000-0000-0000-0000-000000000000'::uuid, 'MA-QUET-THUC-TE'::text)
)
SELECT
  x.transaction_id AS requested_uuid,
  (SELECT count(*) FROM public.stock_transactions AS s
   WHERE s.transaction_id = x.transaction_id) AS uuid_count,
  COALESCE(t.product_id, u.product_id) AS product_id,
  t.scan_code_snapshot,
  t.scan_point_id,
  t.movement_type,
  t.quantity_packages,
  t.conversion_factor_snapshot,
  t.inventory_before,
  t.inventory_after,
  i.quantity_base AS current_inventory,
  i.updated_at AS inventory_updated_at,
  t.created_at
FROM input AS x
LEFT JOIN public.stock_transactions AS t USING (transaction_id)
LEFT JOIN public.product_units AS u ON u.scan_code = x.scan_code
LEFT JOIN public.inventory AS i ON i.product_id = COALESCE(t.product_id, u.product_id);

COMMIT;
```

Sau 01, đối chiếu `uuid_count = 1` và `inventory_after` với response. Sau 02–03, kiểm tra số dòng vẫn bằng 1, số gói và dữ liệu gốc giữ nguyên, `current_inventory` và `inventory_updated_at` khớp mốc trước khi replay.

## F. Quay video

| Cảnh | Nội dung hiện trên màn hình | Giữ màn hình |
| --- | --- | --- |
| 1 · Đầu vào | Hiện collection Simple Demo, mã quét, số gói, loại giao dịch và điểm quét. Nêu trước kỳ vọng 201, 200 và 409. | 8–12 giây |
| 2 · Tạo mới | Gửi 01, hiện 201, sao chép UUID và giữ màn hình ở `inventory_before`, `inventory_after`. Mở SQL để hiện một dòng giao dịch. | 8–12 giây mỗi màn hình |
| 3 · Replay | Hiện cùng UUID, gửi 02, giữ thông báo và `is_duplicate: true`. Mở Test Results và SQL để hiện tồn và số dòng giữ nguyên. | 8–12 giây mỗi màn hình |
| 4 · Thay đổi số gói | Giữ UUID, nói rõ 03 đổi số gói nhưng giữ dữ liệu khác. Gửi 03 và giữ màn hình ở 409, Test Results và kết quả SQL cuối. | 8–12 giây mỗi màn hình |

Để quay một lượt mới, lưu UUID và kết quả SQL của lượt cũ, rồi xóa ô `transactionId` trong Variables trước khi gửi 01. Lượt mới dùng UUID khác và lấy tồn lúc đó làm mốc. Nếu lượt cũ mất phản hồi ngay sau 01, đối chiếu UUID bằng 02 hoặc SQL trước khi tạo lượt mới. Khi ghi hình, chỉ mở dữ liệu demo, response nghiệp vụ và kết quả SQL.

## Kết quả bàn giao

**PARTIAL**. Các kiểm tra tự động đã đạt. Cần import và xác minh quyền Local Vault trên Postman Desktop. Tiến trình ở cổng 3000 trả health `200` nhưng Swagger chưa có route replay, nên cần chạy lại backend từ mã hiện tại.

| Kiểm tra | Kết quả |
| --- | --- |
| Backend unit và e2e | 20 unit test và 331 e2e test đạt, gồm PostgreSQL 17 QA cục bộ. |
| Frontend liên quan | 8 test đạt. |
| Newman trên API mô phỏng | Schema v2.1 hợp lệ, đúng ba request. Kiểm tra UUID tự sinh và nhập tay, IN/OUT, đổi mã quét và hệ số, UUID thiếu, sai STAFF và backend phiên bản cũ. |
| Newman trên NestJS chạy thật với PostgreSQL QA | 25 kiểm tra đạt. Backend xác minh JWT qua JWKS của QA. Newman cấp JWT QA trong bộ nhớ thay cho bước đọc Vault. |
| Supabase thật | Truy vấn đối chiếu chỉ đọc. Chưa thực hiện 01–03 trên Production. |

Trong QA, sản phẩm `P1` nhập 3 gói hệ số 1, tồn từ 100 lên 103. Replay và conflict giữ nguyên số tồn và một bản ghi. Sản phẩm `PLOCK` nhập 2 gói hệ số 24, tồn từ 0 lên 48. Khi đổi sang mã hộp của `P1` rồi xuất 2 gói, tồn còn 55. Replay UUID nhập cũ vẫn hiện snapshot gốc 100 → 103, đồng thời xác nhận tồn hiện tại giữ ở 55.
