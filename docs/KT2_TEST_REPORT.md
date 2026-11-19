# Báo cáo kiểm thử KT2 · Smart Warehouse

## Mục tiêu và dữ liệu

KT2 kiểm tra một UUID chỉ tạo một giao dịch và cộng tồn một lần. Gửi lại nội dung cũ phải trả `200`, còn dùng UUID với số lượng khác phải trả `409`.

| Mục | Giá trị |
| --- | --- |
| Backend | `http://localhost:3000`, health HTTP `200`, PostgreSQL connected |
| Sản phẩm | `SP017` — Compa |
| Mã và điểm quét | `SW-SP017-01`, `SCAN-01` |
| Tài khoản | STAFF Yến Vy, đang hoạt động và có đúng một phân công đang hoạt động tại SCAN-01 theo truy vấn PostgreSQL |
| Dữ liệu gửi | `IN`, `quantity_packages = 1` cho 02 và 03, `2` cho 04. Hệ số quy đổi hiện tại là 1. |
| Ảnh chụp dữ liệu trước kiểm thử | PostgreSQL ghi nhận 17 cái và 5 giao dịch SP017 lúc 20:03:37 ngày 19/11/2026 (UTC+7). `updated_at` của tồn là `2026-11-18 13:49:36.884258+07`. |
| Tồn ngay trước POST 02 (`N`) | Chưa đo cho đợt live. Cần chạy lại 01 và SQL ngay trước khi gửi. |
| UUID của đợt live | Chưa ghi nhận |

## Kết quả trên kho thật

Thông tin ban đầu do người dùng ghi nhận gồm đăng nhập Supabase HTTP `200` và GET inventory HTTP `200` với 20 sản phẩm. Kết quả phiên STAFF và các POST của đợt này đang chờ thực hiện trong Postman Desktop.

| Lần gửi | HTTP mong đợi | HTTP thực tế | Tồn mong đợi | Tồn thực tế | Kết quả |
| --- | ---: | --- | --- | --- | --- |
| 01 · đọc tồn và kiểm tra UUID | 200 | Chưa đo trong đợt live | `N` | Chưa đo | Chờ phiên STAFF |
| 02 · UUID mới, 1 cái | 201 | Chưa gửi | `N + 1` | Chưa đo | Chờ thực hiện |
| 03 · phát lại nguyên body | 200 | Chưa gửi | `N + 1` | Chưa đo | Chờ thực hiện |
| 04 · cùng UUID, 2 cái | 409 | Chưa gửi | `N + 1` | Chưa đo | Chờ thực hiện |

Kỳ vọng số bản ghi theo UUID là `0 → 1 → 1 → 1`. Sau bước 02, `inventory_before = N`, `inventory_after = N + 1` và `inventory.quantity_base = N + 1`. `updated_at` sau 03 và 04 phải bằng giá trị sau 02. Kết quả đếm theo UUID mới đang chờ thực hiện.

## Kiểm chứng collection trên dữ liệu mô phỏng

Schema Postman Collection v2.1 hợp lệ. Newman chạy với Vault và HTTP mô phỏng, đạt đủ `200 → 201 → 200 → 409` cho 01–04. Kiểm tra xác nhận 02 và 03 có body giống từng byte, 04 chỉ đổi số lượng, cả ba POST cùng UUID và tồn chỉ tăng một lần. Collection chặn POST khi thiếu baseline, sai role, sai hệ số quy đổi hoặc còn lần gửi 02 đang chờ đối chiếu. Thay đổi `updated_at` giả lập khi replay làm assertion thất bại và dừng trước 04.

## SQL đối chiếu

Thay hai giá trị ở dòng `VALUES` bằng `transactionId` và `productId` của đợt trong Postman. Chạy cả khối ngay trước 02 và sau từng POST. Mỗi lần chạy đọc một snapshot mới và giữ độ chính xác gốc của PostgreSQL cho timestamp.

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH input(transaction_id, product_id) AS (
  VALUES ('00000000-0000-0000-0000-000000000000'::uuid, 'SP017'::text)
),
matching AS (
  SELECT t.*
  FROM public.stock_transactions AS t
  JOIN input AS x USING (transaction_id)
)
SELECT
  x.transaction_id AS requested_uuid,
  x.product_id,
  i.quantity_base AS inventory_quantity,
  i.updated_at AS inventory_updated_at,
  (SELECT count(*) FROM matching) AS uuid_count,
  (SELECT count(*) FROM public.stock_transactions AS s
   WHERE s.product_id = x.product_id) AS product_transaction_count,
  m.product_id AS transaction_product,
  m.scan_point_id,
  m.scan_code_snapshot,
  m.movement_type,
  m.quantity_packages,
  m.conversion_factor_snapshot,
  m.quantity_base AS transaction_quantity,
  m.inventory_before,
  m.inventory_after,
  m.created_at AS transaction_created_at
FROM input AS x
JOIN public.inventory AS i USING (product_id)
LEFT JOIN matching AS m USING (transaction_id);

COMMIT;
```

Đối chiếu `requested_uuid` và snapshot với phản hồi POST, `inventory_quantity` với GET Inventory, và `uuid_count` với GET lịch sử. Tổng số giao dịch của sản phẩm đã chọn phải tăng đúng 1 so với trước 02. Nếu tồn, timestamp hoặc tổng số giao dịch cho thấy có thay đổi ngoài kịch bản, ghi nhận chênh lệch rồi xác minh trước khi kết luận. Với POST mất phản hồi, truy vấn cùng UUID trước khi quyết định bước tiếp theo.

## Sự cố và xử lý

- GET HTTP `200` nhưng `2/3` và UUID trống. Bản JSON cũ đọc biến collection `accessToken` cho các GET phụ. Kết hợp cấu hình Bearer Vault ở request chính với biến cũ trống sẽ tạo đúng triệu chứng này. Chưa xem được tên assertion trên bản Copy. Bản mới đọc token từ cùng Vault cho cả hai đường và đặt script 01 ngay tại request.
- Phiên làm việc này thiếu `node_repl` để điều khiển Postman Desktop. Quyền Vault phải do người dùng cấp trong Postman. [Postman Vault](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-vault)

**KT2 OVERALL — BLOCKED**. PostgreSQL chỉ đọc đã xác nhận dữ liệu chuẩn bị. Cần kết quả Postman với phiên STAFF và các ảnh chụp SQL cùng UUID để kết luận PASS hoặc FAIL.
