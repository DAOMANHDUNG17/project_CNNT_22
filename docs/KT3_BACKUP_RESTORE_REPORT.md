# KT3-B — Báo cáo backup và restore

Dự án Smart Warehouse, BTL Đề tài 22. Kiểm tra ngày 19/11/2026 (UTC+7).

## Backup

- Archive `D:\KT3_Backups\smart_warehouse_public_20261118_233744_047_ICT.backup`, 27.125 byte. `pg_restore -l` trả mã 0 và xác nhận định dạng CUSTOM, nguồn PostgreSQL 17.11.
- Metadata `D:\KT3_Backups\smart_warehouse_public_20261118_233744_047_ICT.metadata.json`. Đường dẫn, kích thước và SHA-256 của archive khớp với mốc đã lưu.
- SHA-256 `2273bb2acd9bf3db8453b33122ef3b19afaa2a44d66dc95f8198e0d4020252ba`.
- Kiểm tra trực tiếp nội dung archive xác nhận có cấu trúc và dữ liệu của cả bảy bảng bên dưới, 2 sequence và giá trị cuối của sequence, 2 function, 4 trigger, 7 khóa chính và 10 khóa ngoại.

## Lỗi pgAdmin và cách khắc phục

Log tiến trình pgAdmin `261118172505849033` ghi exit code **1**, lỗi `schema "public" already exists`, câu lệnh gây lỗi là `CREATE SCHEMA public;`. Lần restore trước dùng một transaction và dừng khi gặp lỗi tạo schema.

Đích được chỉ định là PostgreSQL 17 tại `127.0.0.1:5432`, database `smart_warehouse_kt3_restore`. Lệnh kiểm tra từ terminal trả mã **2** khi chưa có mật khẩu. Lần nhập trực tiếp sau đó bị PostgreSQL từ chối xác thực. Có thể tiếp tục từ PSQL Tool trên database QA bằng phiên đăng nhập local của pgAdmin. Bước kiểm tra chỉ đọc sẽ xác minh host, port, tên database, vai trò kết nối, đối tượng trong schema `public`, extension và đúng 5 UUID trong `auth.users` trước khi ghi dữ liệu.

Đã rà mã pgAdmin 4 cài trên Windows. Khi pgAdmin có mật khẩu cho kết nối đã chọn, `get_connection_str()` xuất `PGPASSWORD` trước khi khởi chạy terminal của PSQL Tool. Lệnh `\!` khởi chạy tiến trình con. Chế độ `--pgadmin-session` chỉ dùng mật khẩu được cấp qua môi trường tiến trình, rồi mở kết nối PostgreSQL riêng với host, port và database cố định. Việc xác thực được kiểm chứng bằng một truy vấn chỉ đọc trước khi chạy `pg_restore`.

Trong lượt nhập mật khẩu trực tiếp, log PostgreSQL xác nhận cả ba lần đều bị từ chối xác thực với `postgres`. Vì vậy lượt đó dừng trước bước kiểm tra đích và chạy restore.

Trong PSQL Tool, lần gọi Python dừng khi khởi động do không nạp được module chuẩn `encodings`. Đã tái hiện lỗi với cấu hình Python của pgAdmin và chạy thành công bước kiểm tra archive với `python.exe -E`. Cờ này làm Python bỏ qua các biến môi trường cấu hình Python. Mật khẩu PostgreSQL vẫn do pgAdmin cấp cho tiến trình nếu có.

Đã chuẩn bị TOC riêng, chỉ vô hiệu hóa mục `38; 2615 2200 SCHEMA - public pg_database_owner`. Đọc thử archive qua TOC này thành công. Các mục bảng, dữ liệu, function, trigger và constraint vẫn có mặt. Lệnh restore đã chạy sau khi xác thực và kiểm tra đích:

```powershell
& 'C:\Program Files\PostgreSQL\17\bin\pg_restore.exe' `
  --host=127.0.0.1 --port=5432 --username=postgres `
  --dbname=smart_warehouse_kt3_restore --no-password `
  --no-owner --no-acl --single-transaction --exit-on-error `
  --use-list 'C:\Users\Admin\AppData\Local\Temp\kt3-restore-20261119-f5da0781\public-qa.restore.list' `
  'D:\KT3_Backups\smart_warehouse_public_20261118_233744_047_ICT.backup'
```

## Đối chiếu dữ liệu

| Bảng | Backup | Trước restore | Sau restore | Khớp từng dòng |
|---|---:|---|---:|---|
| `products` | 17 | Chưa có bảng | 17 | Có |
| `product_units` | 34 | Chưa có bảng | 34 | Có |
| `inventory` | 17 | Chưa có bảng | 17 | Có |
| `stock_transactions` | 17 | Chưa có bảng | 17 | Có |
| `scan_points` | 2 | Chưa có bảng | 2 | Có |
| `users` | 5 | Chưa có bảng | 5 | Có |
| `user_scan_point_access` | 5 | Chưa có bảng | 5 | Có |

Mốc archive xác nhận **SP017 — Compa, 17 Cái** và giao dịch KT2 `f016270f-451d-422a-a5b7-befe8173ed16` xuất hiện đúng một lần. JSON ghi thời điểm cập nhật tồn đến mili giây, archive giữ đến micro giây.

Khóa ngoại `public.users.auth_user_id → auth.users(id)` vẫn có trong TOC. Bảng Auth tối thiểu trên QA chỉ phục vụ khóa ngoại. Archive giới hạn ở schema `public`, nên các thông tin xác thực, cấu hình và dịch vụ Supabase Auth nằm ngoài phạm vi khôi phục.

## Kết quả thực tế

Trạng thái **PASS**. `pg_restore` trả mã **0**. Lần chạy thành công dùng `python.exe -E` từ PSQL Tool. Script xác thực qua kết nối local riêng trước khi chạy restore.

Đã xác minh đích `smart_warehouse_kt3_restore` qua `127.0.0.1:5432`, PostgreSQL 17.11. Trước restore có 0 đối tượng phụ thuộc schema public, chủ sở hữu `pg_database_owner`, extension local gồm plpgsql.

Đã kiểm tra 5 UUID trong `auth.users` qua kết nối local. Tập UUID khớp với archive trước khi chạy pg_restore.

**SP017 — Compa, 17 Cái**, cập nhật `2026-11-18T06:49:36.884258+00:00`. UUID KT2 có **1** bản ghi. Số giao dịch sai công thức và số dư là **0**.

Khóa chính được xác thực **7/7**. Khóa ngoại được xác thực **10/10**. Bản ghi mồ côi **0** trên 10 quan hệ.

Khóa ngoại đã kiểm tra:

- `fk_stock_product`: `stock_transactions` → `products`. Hợp lệ.
- `fk_stock_scan_point`: `stock_transactions` → `scan_points`. Hợp lệ.
- `fk_stock_unit_product`: `stock_transactions` → `product_units`. Hợp lệ.
- `fk_stock_user`: `stock_transactions` → `users`. Hợp lệ.
- `inventory_product_id_fkey`: `inventory` → `products`. Hợp lệ.
- `product_units_product_id_fkey`: `product_units` → `products`. Hợp lệ.
- `user_scan_point_access_assigned_by_fkey`: `user_scan_point_access` → `users`. Hợp lệ.
- `user_scan_point_access_scan_point_id_fkey`: `user_scan_point_access` → `scan_points`. Hợp lệ.
- `user_scan_point_access_user_id_fkey`: `user_scan_point_access` → `users`. Hợp lệ.
- `users_auth_user_id_fkey`: `users` → `auth.users`. Hợp lệ.

Function đã kiểm tra gồm `create_inventory_for_product`, `set_updated_at`. Trigger đã kiểm tra gồm `trg_users_updated_at`, `trg_product_inventory`, `trg_products_updated_at`, `trg_inventory_updated_at`.

Đã kiểm tra **32 constraint** trong public, trạng thái RLS trên **7 bảng** và giá trị của **2 sequence**. Đối chiếu các cột lưu trong archive theo multiset của dòng COPY. Cột phát sinh quantity_base được kiểm tra riêng theo công thức nghiệp vụ.

## Kết luận

| Hạng mục | Trạng thái |
|---|---|
| BACKUP | **PASS** |
| RESTORE | **PASS** |
| DATA INTEGRITY | **PASS** |
| KT3-B OVERALL | **PASS** |
