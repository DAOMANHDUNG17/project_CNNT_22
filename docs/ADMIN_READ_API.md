# API đọc bổ sung cho Admin Dashboard

Các endpoint dưới dùng phiên đã xác thực do backend kiểm tra. `/api/users` chỉ ADMIN; các endpoint kho/dashboard theo ma trận quyền đọc. Module mới không tự xác thực người dùng, app phải mount middleware phiên trước `dashboardReadRouter` và cung cấp `requireAdmin`.

Danh sách giữ `{data:[],count,pagination:{page,limit,total,totalPages}}`; page=1, limit=20, tối đa 100. Các giá trị count nghiệp vụ, aggregate quantity và ID bigint là JSON string; metadata phân trang là number. Query không hỗ trợ, lặp/array/object, ngày hoặc enum sai trả 400. Không có kết quả list trả 200/data=[]; detail không có trả 404.

| Endpoint | Query hợp lệ | Nội dung |
| --- | --- | --- |
| GET /api/inventory/low-stock | page,limit,threshold,q | threshold mặc định `"10"`, số nguyên 0–9223372036854775807 dạng chuỗi chuẩn; lọc quantity_base **nhỏ hơn** threshold; q tìm literal không phân biệt hoa/thường trên mã/tên sản phẩm |
| GET /api/transactions/:id | Không | UUID chuẩn; projection như GET transactions; snapshot/số lượng/tồn sau giao dịch lấy từ hàng lịch sử |
| GET /api/users | page,limit,q,role,isActive | ADMIN; q username/display_name; role ADMIN/KEEPER/STAFF/VIEWER; isActive đúng true hoặc false; không password_hash/auth_version |
| GET /api/dashboard/summary | threshold | Tổng products, active/inactive, số product thiếu inventory, transaction counts IN/OUT, low stock, tổng tồn tách theo base_unit |
| GET /api/dashboard/stock-trends | page,limit,from,to,granularity,productId,movementType,scanPointId | granularity day(default)/month; count giao dịch từng khoảng UTC, gồm khoảng rỗng với count 0 |
| GET /api/dashboard/top-products | page,limit,from,to,productId,movementType,scanPointId,q,baseUnit,sortBy | sortBy transactions(default)/inQuantity/outQuantity; sort quantity bắt buộc baseUnit để tránh xếp hạng các đơn vị khác loại |

`from`/`to` là YYYY-MM-DD hợp lệ, hai đầu **bao gồm** theo UTC, tối đa 366 ngày. Nếu thiếu to thì lấy ngày UTC hiện tại; nếu thiếu from thì lấy 29 ngày trước to (30 ngày tính cả hai đầu). Bộ lọc movementType nhận IN/OUT chính xác, các ID được trim và giới hạn theo schema. Tên product và đơn vị là giá trị hiện tại; số liệu giao dịch vẫn dùng snapshot đã lưu.

Low-stock chỉ đọc các hàng inventory hiện có và gồm cả product inactive giống API inventory hiện tại; không giả định sản phẩm thiếu inventory có tồn 0. Summary báo riêng missing_inventory. Threshold được áp vào số đơn vị cơ sở của từng sản phẩm; không có metadata ngưỡng riêng trên product nên caller cần chọn ngưỡng phù hợp với nghiệp vụ/đơn vị.

Summary trả:

```json
{
  "data": {
    "products": { "total": "0", "active": "0", "inactive": "0", "missing_inventory": "0" },
    "inventory_totals": [],
    "transactions": { "IN": "0", "OUT": "0", "total": "0" },
    "low_stock": { "threshold": "10", "product_count": "0" }
  }
}
```

Đây chỉ là minh họa shape với dataset rỗng, không phải dữ liệu runtime. inventory_totals gồm `{base_unit,quantity_base}` theo base_unit; không có field tổng cộng trộn các đơn vị khác nhau. Hai nhãn base_unit giống nhau được coi cùng đơn vị do schema hiện tại chỉ có nhãn này; chưa có hệ dimensional-unit hoặc quy đổi giữa đơn vị cơ sở.

Trends data[] gồm `period_start` ISO UTC, `in_count`, `out_count`, `total_count` dạng chuỗi. Đếm khoảng rỗng bằng generate_series không tạo transaction giả. API không cộng số lượng các đơn vị khác loại trong trend.

Top products data[] gồm `product_id,product_name,base_unit,transaction_count,in_count,out_count,quantity_in_base,quantity_out_base`. Quantity mỗi hàng là tổng theo đơn vị cơ sở của **chính sản phẩm**; sort mặc định theo số lượt giảm dần rồi product_id tăng dần, sort quantity chỉ khi caller đã chọn baseUnit. Chỉ sản phẩm có giao dịch khớp khoảng/filter xuất hiện, không thêm hàng zero giả. Số tổng lấy từ quantity_base đã lưu, không nhân lại bằng factor hiện tại.

Transaction detail không có user_id/password_hash/request_scan_code/auth_version. User list gồm user_id,username,display_name,role,is_active,created_at. Các trường nội bộ/hashes dù xuất hiện do adapter trả thêm vẫn bị projection loại khỏi response.

Mỗi list/summary được truy vấn trong một statement để page/count hoặc KPI cùng snapshot PostgreSQL. Những request kế tiếp có thể nhìn thấy dữ liệu mới khi có giao dịch khác commit. Những unit test của module chỉ chứng minh validation/projection/SQL parameterization và shape; cần integration thật trước khi gọi API được xác minh với PostgreSQL.
