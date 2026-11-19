# Demo KT2 trên Swagger · Smart Warehouse

## 1. Mở Swagger và Authorize

1. Mở [Swagger UI](http://localhost:3000/api/docs). Trong **07 — Quản trị hệ thống**, chạy **GET /api/health → Try it out → Execute**. Kết quả sẵn sàng là HTTP `200` và `database: connected`.
2. Đăng nhập bằng tài khoản STAFF của môi trường demo để lấy access token Supabase. Có thể dùng request 00 trong Postman của dự án để làm mới phiên. Trong Swagger, nhấn **Authorize**, dán access token vào ô bearer, nhấn **Authorize** rồi đóng hộp thoại. Swagger tự thêm tiền tố `Bearer`. [Đăng nhập STAFF qua Postman](KT2_POSTMAN.md#import-và-đăng-nhập)
3. Trong **01 — Xác thực & tài khoản**, chạy **GET /api/auth/me** để xem `role: STAFF` và `is_active: true`. Trong **06 — Điểm quét & phân công**, chạy **GET /api/scan-points/my** để lấy `scan_point_id` đang hoạt động. Dùng cùng tài khoản và điểm quét trong ba lượt.

Ô tìm kiếm lọc theo tên nhóm hoặc đường dẫn. Gõ `/api/stock-movements` để tìm các POST kho, hoặc `Lịch sử` để tìm GET tra cứu. [Tùy chọn lọc Swagger UI](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/)

## 2. Lấy mã quét và số tồn trước khi gửi

- Trong **02 — Danh mục sản phẩm**, mở **GET /api/product-units** và chọn mã quét có thật. Ghi lại `product_id`, `scan_code` và `conversion_factor`.
- Trong **03 — Quản lý tồn kho**, chạy **GET /api/inventory**. Tìm dòng `product_id` cần thử và ghi lại `quantity_base` cùng `updated_at`. Gọi tồn ban đầu là `N`.
- Tạo UUID mới một lần trong PowerShell bằng `[guid]::NewGuid().ToString()`. Giữ UUID đó cho cả ba lượt của một đợt KT2.

## 3. Gửi 201 → 200 → 409

Mở **04 — Nhập / xuất kho → POST /api/stock-movements → Try it out**. Chọn ví dụ KT2 rồi thay UUID, mã quét, điểm quét và số gói theo dữ liệu vừa xác nhận. Với `IN`, tồn sau lượt đầu phải là `N + quantity_packages × conversion_factor`. Mỗi dòng dưới đây dùng nút **Execute** của cùng endpoint.

| Lượt | Body gửi | Kết quả cần thấy |
| --- | --- | --- |
| 1 · Tạo mới | UUID mới, mã quét thật, đúng điểm quét, `movement_type: "IN"`, ví dụ `quantity_packages: 2`. | **201 Created**. `is_duplicate: false`, `data.inventory_before = N`, `data.inventory_after` bằng tồn dự kiến. |
| 2 · Replay | Giữ nguyên UUID và toàn bộ body của lượt 1. | **200 OK**. Thông báo giao dịch đã xử lý, `is_duplicate: true`, trả dữ liệu giao dịch gốc. |
| 3 · Conflict | Giữ UUID, mã quét, điểm quét và loại giao dịch. Chỉ đổi `quantity_packages`, ví dụ từ 2 thành 3. | **409 Conflict**. Thông báo mã giao dịch đã được dùng cho một lượt nhập/xuất khác. |

Route `POST /api/stock-movements/replay` dành cho replay an toàn của các collection KT2, với UUID thiếu trả 404. Ba lượt demo trên dùng route ghi nhận chính để thấy đủ 201, 200 và 409.

## 4. Đối chiếu lịch sử và PostgreSQL

Sau mỗi lượt, chạy **GET /api/inventory** để so tồn và `updated_at` với mốc sau 201. Trong **05 — Lịch sử giao dịch**, chạy **GET /api/transactions** với `transactionId` đúng UUID và `limit=1`. Sau 201, `count` phải bằng 1. Sau 200 và 409, `count` vẫn bằng 1 và dữ liệu giao dịch giữ nguyên.

Có thể chạy truy vấn chỉ đọc dưới đây trên database của môi trường demo. Thay UUID mẫu trước khi chạy.

```sql
BEGIN TRANSACTION READ ONLY;

WITH input(id) AS (
  VALUES ('00000000-0000-0000-0000-000000000000'::uuid)
)
SELECT
  (SELECT count(*) FROM public.stock_transactions WHERE transaction_id = input.id) AS uuid_count,
  t.transaction_id,
  t.product_id,
  t.scan_code_snapshot,
  t.quantity_packages,
  t.inventory_before,
  t.inventory_after,
  i.quantity_base AS current_inventory,
  i.updated_at AS inventory_updated_at
FROM input
LEFT JOIN public.stock_transactions t ON t.transaction_id = input.id
LEFT JOIN public.inventory i ON i.product_id = t.product_id;

COMMIT;
```

Khi quay, giữ màn hình ở HTTP status, khối response và bảng SQL. Chuẩn bị Authorization trước khi ghi hình. Với KT1, nhóm nhập/xuất dùng cùng endpoint với UUID riêng cho từng giao dịch. Với KT3, Authorize bằng VIEWER và dùng các GET nghiệp vụ theo runbook. [Runbook KT3](KT3_QA_RUNBOOK.md)
