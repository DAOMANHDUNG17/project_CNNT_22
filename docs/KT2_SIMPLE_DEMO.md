# SMART WAREHOUSE — KT2 SIMPLE DEMO

Import [collection v2.1](<SMART WAREHOUSE - KT2 SIMPLE DEMO.postman_collection.json>) vào Postman Desktop. Collection dùng Bearer `{{vault:kt2AccessToken}}` từ Local Vault, cùng secret với collection KT2 cũ. Nếu phiên hết hạn, dùng request **00 - Login STAFF** của [collection cũ](<Smart Warehouse - KT2 API Testing.postman_collection.json>) để làm mới phiên. Bật quyền dùng Vault trong scripts cho collection mới khi Postman yêu cầu. [Postman Local Vault](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-vault)

Backend mặc định là `http://localhost:3000`. Swagger tại `/api/docs` cần có `POST /api/stock-movements/replay`. Mỗi request có các GET tự động để tra cứu và đối chiếu. Collection dùng một cặp script cấp collection.

## Demo trong ba bước

| Bước | Thao tác | Kết quả cần thấy |
| --- | --- | --- |
| **01 — CREATE NEW TRANSACTION (201)** | Điền `scanCode` lấy từ danh mục mã quét, `quantityPackages`, `movementType` và `scanPointId` được phân công. Điểm quét có thể để trống để dùng phân công hiện tại. Xóa giá trị `transactionId` khi chủ động bắt đầu đợt mới, hoặc điền UUID mới đã chọn. | `201`, thông báo tạo thành công và `is_duplicate: false`. Body hiển thị UUID, sản phẩm, số lượng, tồn trước/sau. Script đọc hệ số từ `GET /api/product-units` và so tồn theo `số gói × hệ số`. |
| **02 — CHECK & REPLAY UUID (200)** | Giữ UUID từ 01, hoặc dán UUID giao dịch cũ vào `transactionId` rồi nhấn Send. | `200`, thông báo không ghi trùng, `is_duplicate: true` và nội dung gốc. **Test Results** xác nhận tìm thấy UUID, chỉ có một dòng và tồn cùng `updated_at` giữ nguyên. |
| **03 — MODIFY SAME UUID — REJECT (409)** | Giữ UUID đã qua 02 rồi nhấn Send. Script chỉ tăng số gói thêm 1. Với số gói gốc đã đạt giới hạn DTO, script giảm 1 để vẫn gửi một số hợp lệ khác. | `409`, backend báo UUID đã dùng cho nội dung khác. **Test Results** xác nhận từ chối sửa và giữ nguyên bản ghi, tồn và `updated_at`. |

Ở 01, UUID v4 chỉ được sinh khi `transactionId` trống. Collection lưu UUID vào biến ngay khi sinh. Với UUID nhập tay, collection giữ giá trị và chặn 01 nếu UUID đã có. Nếu mất phản hồi sau khi gửi, giữ UUID để kiểm tra bằng 02 hoặc SQL trước khi bắt đầu đợt khác.

Ở 02–03, script lấy dữ liệu gốc qua `GET /api/transactions?transactionId=…&scanPointId=…&limit=1`, với điểm quét đang được phân công. Cần dùng đúng STAFF đã tạo giao dịch. Nếu UUID không tìm thấy, Postman Console ghi **Không tìm thấy giao dịch với UUID này** và POST được bỏ qua. Bước 02–03 dùng route chỉ replay, trong đó backend trả `404` nếu UUID thiếu khi xử lý POST. [API tra cứu](../backend/src/transactions/transactions.controller.ts), [API replay](../backend/src/stock-movements/stock-movements.controller.ts)

Khi quay, mở **Body** và **Test Results** sau từng bước, giữ màn hình khoảng 8–12 giây để đọc thông báo và các số tồn. Biến `_kt2LastReplayId` do script quản lý.

## SQL đối chiếu cho giảng viên

Thay UUID và mã quét ở dòng `VALUES`. Chạy cùng truy vấn sau mỗi bước. Sau 01, `uuid_count` phải là 1 và tồn khớp `inventory_after`. Sau 02–03, so lại tồn hiện tại, `inventory_updated_at`, số dòng và dữ liệu gốc. Với UUID lịch sử đã có các giao dịch phát sinh sau đó, dùng tồn **trước khi chạy 02** làm mốc đối chiếu.

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
  t.created_at,
  i.quantity_base AS current_inventory,
  i.updated_at AS inventory_updated_at
FROM input AS x
LEFT JOIN public.stock_transactions AS t USING (transaction_id)
LEFT JOIN public.product_units AS u ON u.scan_code = x.scan_code
LEFT JOIN public.inventory AS i ON i.product_id = COALESCE(t.product_id, u.product_id);

COMMIT;
```
