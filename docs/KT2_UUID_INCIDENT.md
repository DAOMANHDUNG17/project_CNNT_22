# KT2 · Điều tra UUID giao dịch kho SP020 và SP017

## Dữ liệu Supabase Production

Snapshot chỉ đọc lúc 02:45 ngày 20/11/2026 (UTC+7) ghi nhận hai giao dịch `IN` tại `SCAN-01` với hai UUID khác nhau. Trong nhóm đầu của UUID, `c7` thuộc SP020 và `7c` thuộc SP017. Các mã quét dưới đây đều có hệ số quy đổi 1.

| Sản phẩm | UUID lưu trong DB | Mã quét đã lưu | Số gói | Tồn trước → sau | Giờ ghi (UTC+7) |
| --- | --- | --- | ---: | --- | --- |
| SP020 | `b871ac7b-dcf3-4a64-8b06-a9dc0ef1c582` | `SW-SP020-01` | 3 | 9 → 12 | 02:30:46.979 |
| SP017 | `b871a7cb-dcf3-4a64-8b06-a9dc0ef1c582` | `SW-SP017-01` | 1 | 18 → 19 | 02:38:04.358 |

UUID nêu trong sự cố thuộc SP017. Bản ghi SP020 khớp mã quét, số gói và mốc tồn 9 → 12 của báo cáo, nhưng mang UUID còn lại. Khi UUID của SP017 được gửi lần đầu với payload hợp lệ, `201 Created` và tồn 18 → 19 phù hợp với hợp đồng API. Database lưu giao dịch đã commit, nên hai bản ghi chứng minh hai UUID khác nhau, còn request/response HTTP đã gửi trong Swagger cần bản ghi từ trình duyệt để xác nhận từng lượt.

Bảng `public.stock_transactions` có 33 bản ghi, 33 UUID phân biệt và 0 nhóm UUID trùng. Tồn quan sát được là SP017 = 19 và SP020 = 12. Nếu lượt `IN +1` của SP017 chỉ là thao tác demo ngoài dự kiến, đối chiếu UUID, thời điểm và chứng từ hoặc tồn thực tế trước khi người phụ trách quyết định điều chỉnh theo quy trình kho.

Backend nghe cổng 3000 dùng bản build tại `backend/dist/main`. Định danh dự án trong cấu hình PostgreSQL khớp Supabase Auth. Socket của tiến trình backend khớp đích cấu hình. Khi gọi `GET /api/health`, backend báo `database: connected` và phiên `SELECT 1` tương ứng cập nhật thời điểm chạy trên chính database đang audit. Không có POST/PATCH/DELETE, migration hay điều chỉnh tồn nào được thực hiện trên Production trong đợt kiểm tra.

## Cơ chế bảo vệ UUID

- `stock_transactions_pkey` là `PRIMARY KEY (transaction_id)` trên bảng thường, cột kiểu `uuid NOT NULL`. Index B-tree của khóa chính là unique, valid và ready. Index theo `(product_id, created_at DESC)` phục vụ lịch sử sản phẩm.
- `StockMovementsController` lấy trạng thái 201 hoặc 200 từ kết quả service. `CreateStockMovementDto` nhận UUID và `scan_code`. Backend dùng mã quét để xác định sản phẩm và trả `product_id` trong response.
- `StockMovementsService` khóa theo UUID đã chuẩn hóa và tra cứu bằng `WHERE t.transaction_id = $1` trước khi xử lý tồn. UUID trùng với mã quét, loại giao dịch, số lượng hoặc nội dung điểm quét khác trả 409 nếu yêu cầu đủ quyền. Điểm quét ngoài phân công trả 403. Replay hợp lệ trả 200 với bản ghi cũ.
- Nhánh 201 chạy `UPDATE public.inventory` và `INSERT INTO public.stock_transactions` trong cùng transaction PostgreSQL qua `DatabaseService`. Nhánh lỗi làm rollback. Nếu PostgreSQL báo `23505`, service tra lại theo UUID toàn bảng trong transaction mới rồi phân loại replay hoặc conflict.
- API lịch sử có thể kết hợp bộ lọc `transactionId` với `productId`. Bộ lọc này chỉ phục vụ đọc lịch sử. Luồng ghi kho dùng SQL trực tiếp, và kiểm tra catalog không tìm thấy hàm PostgreSQL ghi vào `stock_transactions`. Trigger liên quan trên `inventory` cập nhật `updated_at`.

Khóa chính hiện tại đã bảo đảm UUID duy nhất toàn bảng. Không cần migration, index unique bổ sung hay thay đổi logic ghi kho. Thay đổi trong controller chỉ là mô tả OpenAPI, hướng dẫn sao chép `data.transaction_id` và nêu rõ 409 khi cùng UUID nhưng khác sản phẩm.

## SQL đối chiếu chỉ đọc

Chạy khối sau trên database cần kiểm tra. Truy vấn đầu cần trả `same_uuid = false` và hai dòng tương ứng SP020, SP017. Truy vấn nhóm UUID cần trả 0 dòng. Hai truy vấn catalog cho biết khóa chính và các index đang có. Sau khi chạy replay hoặc conflict trên QA, thay UUID bên dưới bằng UUID đã thử và so lại số dòng, số tồn và `inventory_updated_at` ở cả hai sản phẩm với snapshot sau lượt 201.

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH ids AS (
  SELECT 'b871ac7b-dcf3-4a64-8b06-a9dc0ef1c582'::uuid AS sp020_id,
         'b871a7cb-dcf3-4a64-8b06-a9dc0ef1c582'::uuid AS sp017_id
)
SELECT ids.sp020_id = ids.sp017_id AS same_uuid,
       t.transaction_id, t.product_id, t.scan_code_snapshot,
       t.scan_point_id, t.movement_type, t.quantity_packages,
       t.conversion_factor_snapshot, t.inventory_before, t.inventory_after,
       t.created_at
FROM ids
JOIN public.stock_transactions t ON t.transaction_id IN (ids.sp020_id, ids.sp017_id)
ORDER BY t.created_at;

SELECT count(*) AS rows, count(DISTINCT transaction_id) AS distinct_uuids
FROM public.stock_transactions;

SELECT transaction_id, count(*) AS copies, array_agg(product_id ORDER BY product_id) AS products
FROM public.stock_transactions
GROUP BY transaction_id
HAVING count(*) > 1;

SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.stock_transactions'::regclass AND contype IN ('p', 'u');

SELECT indexrelid::regclass AS index_name, indisunique, indisvalid, indisready,
       pg_get_indexdef(indexrelid) AS definition
FROM pg_index
WHERE indrelid = 'public.stock_transactions'::regclass;

SELECT product_id, quantity_base, updated_at AS inventory_updated_at
FROM public.inventory
WHERE product_id IN ('SP017', 'SP020')
ORDER BY product_id;

COMMIT;
```

## Kết quả kiểm thử

| Kịch bản trên PostgreSQL QA | Kết quả |
| --- | --- |
| SP020, UUID mới | 201, `is_duplicate: false`, tồn SP020 9 → 12, tạo một dòng |
| SP020, replay nguyên payload | 200, `is_duplicate: true`, trả dữ liệu gốc |
| Cùng UUID, đổi số gói hoặc IN → OUT | 409 |
| Dùng UUID của SP020 cho SP017 hoặc ngược lại | 409 ở cả hai chiều |
| Đổi điểm quét | 409 nếu có quyền ở điểm mới, 403 nếu điểm ngoài phân công |
| Hai request đồng thời, hai sản phẩm, một UUID | Một 201 và một 409. Chỉ tồn của giao dịch được tạo thay đổi |
| Ghi trực tiếp hai sản phẩm với cùng UUID trên QA | PostgreSQL từ chối bản ghi thứ hai bằng `23505` tại `stock_transactions_pkey` |
| Hai UUID khác nhau như trong sự cố | Hai 201. Mỗi UUID có một dòng riêng |

Các test so sánh số tồn, `updated_at` của cả hai sản phẩm và dữ liệu lịch sử trước và sau replay hoặc conflict. Toàn bộ backend có 20 unit test và 374 e2e test đạt, bao gồm 5 test hồi quy mới và các ca KT1, KT2, KT3 có sẵn. Hai suite Supabase hosted được tắt. 15 unit test frontend liên quan cũng đạt. NestJS build thành công ra thư mục tạm. Bộ e2e chạy trọn sau khi suite kho dùng một HTTP listener loopback cho các request đồng thời. Tiến trình cổng 3000 vẫn chạy bản build hiện tại. Mô tả Swagger mới đã được build kiểm tra và sẽ xuất hiện khi ứng dụng chạy bản build mới.

## Chạy lại trên Swagger QA

1. Authorize bằng STAFF đang được phân công điểm quét cần thử. Dùng `GET /api/product-units` xác nhận hai mã quét và hệ số, rồi đọc tồn của cả hai sản phẩm qua `GET /api/inventory`.
2. Trên `POST /api/stock-movements`, gửi UUID mới với `scan_code: "SW-SP020-01"`, `movement_type: "IN"` và `quantity_packages: 3`. Dùng `SCAN-01` nếu đó là điểm được phân công. Chờ 201 và sao chép `data.transaction_id` từ response.
3. Gửi lại body ban đầu với UUID vừa sao chép. Chờ 200 và `is_duplicate: true`.
4. Giữ cùng UUID, đổi riêng `scan_code` thành `SW-SP017-01`. Chờ 409. Có thể lặp lại với số gói khác hoặc `movement_type: "OUT"`, mỗi lượt chỉ đổi một trường so với body gốc.
5. Kiểm tra `GET /api/transactions?transactionId=<uuid>` và `GET /api/inventory`. UUID vẫn có một dòng SP020. Tồn và `updated_at` của cả hai sản phẩm giữ nguyên so với sau 201. Dùng một UUID mới cho lần thử theo chiều SP017 → SP020.

Khi đối chiếu hai UUID Production đã lưu, dùng GET lịch sử hoặc SQL chỉ đọc.
