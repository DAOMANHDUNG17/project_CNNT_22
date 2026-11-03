# Schema thực tế dùng để thiết kế giai đoạn 2

Kiểm tra ngày 03/11/2026 bằng `warehouse_readonly` trên PostgreSQL 17.11, database `smart_warehouse`, schema `public`. Nguồn: `pg_class`, `pg_attribute`, `pg_constraint`, `pg_indexes`. Chỉ đọc metadata; không đọc các hàng của `users`. Không thay đổi schema hoặc hàm.

`NOT NULL` trừ nơi ghi rõ nullable. Tất cả khóa ngoại được PostgreSQL đánh dấu validated. Sáu bảng chưa bật RLS tại thời điểm kiểm tra.

| Bảng | Cột và kiểu dữ liệu |
| --- | --- |
| products | `product_id varchar(20)` PK; `product_name varchar(150)`; `base_unit varchar(30)`; `is_active boolean` default true; `created_at timestamptz` default now() |
| product_units | `product_unit_id bigint` PK, GENERATED ALWAYS AS IDENTITY; `product_id varchar(20)` FK; `unit_name varchar(30)`; `conversion_factor integer`; `scan_code varchar(80)` UNIQUE; `is_base_unit boolean` default false |
| inventory | `product_id varchar(20)` PK và FK; `quantity_base bigint` default 0; `updated_at timestamptz` default now() |
| stock_transactions | `transaction_id uuid` PK; `product_id varchar(20)` FK; `product_unit_id bigint` thuộc FK kép; `scan_point_id varchar(20)` FK; `user_id bigint` FK; `movement_type varchar(3)`; `quantity_packages integer`; `conversion_factor_snapshot integer`; `quantity_base bigint` generated stored, nullable trong catalog; `inventory_after bigint`; `created_at timestamptz` default now() |
| scan_points | `scan_point_id varchar(20)` PK; `point_name varchar(100)`; `is_active boolean` default true |
| users | `user_id bigint` PK, GENERATED ALWAYS AS IDENTITY; `username varchar(50)` UNIQUE; `display_name varchar(120)`; `role varchar(20)`; `password_hash text` nullable; `is_active boolean` default true; `created_at timestamptz` default now(). Chỉ xác minh metadata, không truy vấn/đưa dữ liệu bảng này vào API. |

Các quan hệ đã xác minh:

- `product_units.product_id → products.product_id`.
- `inventory.product_id → products.product_id`: tối đa một hàng inventory cho mỗi sản phẩm; FK không bảo đảm mọi sản phẩm đều có hàng inventory.
- `stock_transactions.product_id → products.product_id`.
- `(stock_transactions.product_unit_id, stock_transactions.product_id) → (product_units.product_unit_id, product_units.product_id)` qua constraint `fk_tx_unit_belongs_to_product`.
- `stock_transactions.scan_point_id → scan_points.scan_point_id`.
- `stock_transactions.user_id → users.user_id`: xác nhận quan hệ, nhưng API không JOIN users hoặc trả user_id.

Ràng buộc nghiệp vụ hiện có:

- `inventory.quantity_base >= 0`; `stock_transactions.inventory_after >= 0`.
- `movement_type IN ('IN', 'OUT')`; `quantity_packages > 0`; `conversion_factor_snapshot > 0`.
- `stock_transactions.quantity_base` là cột generated stored: `quantity_packages::bigint * conversion_factor_snapshot::bigint`. Không tính lại lịch sử bằng conversion_factor hiện tại của đơn vị.
- `product_units.conversion_factor >= 1`; nếu `is_base_unit=true` thì factor phải bằng 1.
- UNIQUE `(product_id, unit_name)`, `(product_unit_id, product_id)`, `scan_code`.
- Unique partial index `uq_one_base_unit_per_product` trên `product_units(product_id) WHERE is_base_unit`: tối đa một đơn vị cơ sở, không bảo đảm tồn tại một đơn vị cơ sở.
- `users.role` bị giới hạn ADMIN/KEEPER/STAFF/VIEWER; không dùng cho xác thực/phân quyền API ở giai đoạn này.

Index hữu ích hiện có trên giao dịch: `(product_id, created_at DESC)`, `(scan_point_id, created_at DESC)`, `(user_id, created_at DESC)`, cùng PK transaction_id. Chưa đề xuất thay đổi/thêm index trong giai đoạn này.

Baseline quyền thực tế trước cấp quyền: SELECT products=true; SELECT bốn bảng cần mở rộng=false; SELECT users=false; quyền ngoài SELECT ở mức bảng/cột trên cả sáu bảng=false. Baseline dữ liệu products: 10 hàng, mã SP001–SP010. Không đọc dữ liệu bốn bảng chưa có quyền và chưa kết luận số lượng tồn kho/giao dịch.

Fingerprint metadata của hàm được bảo vệ, chỉ đọc định nghĩa để tính hash, không gọi/thay đổi hàm: `public.record_stock_movement(p_transaction_id uuid, p_user_id bigint, p_scan_point_id varchar, p_scan_code varchar, p_movement_type varchar, p_quantity_packages integer)`, `md5(pg_get_functiondef(...)) = 59d25e310aaa5acf12ae7823f154725f`. Dùng làm baseline đối chiếu sau triển khai.
