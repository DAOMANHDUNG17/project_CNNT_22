# REST API giai đoạn 2 — React + Ant Design

Base URL: `http://127.0.0.1:3000/api`. Chỉ GET; chưa có login, token, API ghi, users API hoặc CORS. Dữ liệu runtime đến PostgreSQL qua pg.Pool. Không đưa mật khẩu PostgreSQL vào Frontend.

## Quy ước chung

Danh sách trả cấu trúc sau (minh họa shape với kết quả rỗng, không phải số liệu database hiện tại):

```json
{
  "data": [],
  "count": 0,
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

Chi tiết trả `{ "data": { ... } }`. count luôn bằng data.length; total là tổng số khớp bộ lọc ở DB, totalPages=ceil(total/limit). Trang vượt cuối trả 200/data=[] nhưng vẫn giữ total. Danh sách không tìm thấy trả 200/data=[], không 404.

| Query dùng chung | Quy định |
| --- | --- |
| page | Số nguyên dương dạng thập phân, mặc định 1; không nhận số âm, thập phân, exponent hoặc số vượt vùng an toàn |
| limit | Số nguyên 1–100, mặc định 20; vượt 100 trả 400 |

Chỉ nhận query được liệt kê cho từng route; unknown/repeated/array/object query trả 400. Không nhận số có 0 dẫn đầu như 01. Offset vượt vùng số nguyên an toàn trả 400. Chuỗi được trim; từ chối chuỗi rỗng, quá độ dài hoặc chứa ký tự null. Dùng URLSearchParams/encodeURIComponent để mã hóa chuỗi/path.

bigint như product_unit_id, quantity_base, inventory_after trả **JSON string**. Không đổi sang Number để tính toán vì có thể mất chính xác; hiển thị chuỗi hoặc xử lý BigInt/thư viện số phù hợp. integer như quantity_packages/conversion_factor trả number; boolean trả boolean; timestamptz trả ISO 8601 UTC. Mã SP001 là chuỗi, không tách phần số làm khóa.

Lỗi có shape nhất quán:

```json
{"error":{"code":"PRODUCT_NOT_FOUND","message":"Product not found."}}
```

| HTTP | Code / ý nghĩa |
| --- | --- |
| 200 | Đọc thành công, kể cả danh sách rỗng |
| 400 | INVALID_QUERY cho query/path sai; INVALID_PARAMETER cho URL encoding sai |
| 404 | PRODUCT_NOT_FOUND, INVENTORY_NOT_FOUND hoặc NOT_FOUND |
| 500 | INTERNAL_SERVER_ERROR: lỗi server/quyền/schema, không trả chi tiết SQL |
| 503 | DATABASE_UNAVAILABLE: lỗi kết nối/timeout/DB chưa sẵn sàng |

Cache-Control no-store. Không có trường dữ liệu nhạy cảm từ users trong response.

## GET /health

```http
GET /api/health
```

200: `{"status":"ok","database":"connected"}`. Mỗi lần gọi chạy SELECT 1 thật. DB query lỗi trả 503: `{"status":"error","database":"disconnected"}`. Health giữ response riêng giai đoạn 1, không dùng data/count/pagination và không thay thế preflight quyền các bảng.

## GET /products

```http
GET /api/products?page=1&limit=20&q=SP
```

Query: page, limit, **q** tùy chọn. q được trim, không rỗng, tối đa 150 ký tự; tìm substring không phân biệt hoa/thường theo product_id **hoặc** product_name. `%`, `_`, `!`, `\` được tìm theo nghĩa ký tự thường, không mở wildcard từ người dùng. Không bảo đảm tìm kiếm bỏ dấu tiếng Việt.

| Trường data[] | Kiểu |
| --- | --- |
| product_id | string tối đa 20 ký tự, khóa sản phẩm |
| product_name | string |
| base_unit | string |
| is_active | boolean |
| created_at | string ISO 8601 |

Thứ tự product_id ASC, gồm cả is_active=false. Giữ data/count và các trường sản phẩm giai đoạn 1, nhưng mặc định tối đa 20 hàng. Lấy trang còn lại theo pagination; count không phải tổng số sản phẩm.

## GET /products/:id

```http
GET /api/products/SP001
```

id không rỗng, tối đa 20 ký tự; không nhận query. 200/data là một sản phẩm với các trường trên và **units[]**:

| Trường units[] | Kiểu |
| --- | --- |
| product_unit_id | string bigint |
| product_id | string |
| unit_name | string |
| conversion_factor | number integer |
| scan_code | string |
| is_base_unit | boolean |

units theo product_unit_id ASC; không có đơn vị thì units=[], không tự sinh đơn vị cơ sở. Không tìm thấy sản phẩm: 404 PRODUCT_NOT_FOUND.

## GET /inventory

```http
GET /api/inventory?page=1&limit=20
```

Chỉ page/limit. data[] là các hàng inventory thật JOIN products, theo product_id ASC:

| Trường | Kiểu |
| --- | --- |
| product_id, product_name, base_unit | string |
| is_active | boolean của sản phẩm |
| quantity_base | string bigint, số lượng theo base_unit |
| updated_at | string ISO 8601 |

Không tự thêm sản phẩm thiếu hàng inventory, không thay tồn kho bằng tổng tính lại từ lịch sử.

## GET /inventory/:productId

```http
GET /api/inventory/SP001
```

productId không rỗng, tối đa 20 ký tự; không nhận query. 200/data là một object với các trường inventory list. Không có sản phẩm: 404 PRODUCT_NOT_FOUND. Sản phẩm có nhưng thiếu inventory: 404 INVENTORY_NOT_FOUND, không trả tồn 0 giả định.

Số liệu đã xác minh ngày 03/11/2026: SP001 quantity_base=`"145"`. Giá trị có thể thay đổi khi hệ thống khác phát sinh nghiệp vụ.

## GET /transactions

```http
GET /api/transactions?page=1&limit=20&productId=SP001&movementType=OUT
```

| Query ngoài page/limit | Quy định |
| --- | --- |
| productId | Tùy chọn, không rỗng, tối đa 20 ký tự; mã sản phẩm chính xác |
| movementType | Tùy chọn, chính xác IN hoặc OUT, phân biệt hoa/thường |
| scanPointId | Tùy chọn, không rỗng, tối đa 20 ký tự; mã điểm quét chính xác |

Các bộ lọc kết hợp AND. Không khớp mã sản phẩm/điểm quét trả danh sách rỗng. Thứ tự created_at DESC, transaction_id DESC, kể cả khi trùng thời điểm.

| Trường data[] | Kiểu / ý nghĩa |
| --- | --- |
| transaction_id | string UUID |
| product_id, product_name | string |
| product_unit_id | string bigint |
| unit_name | string, tên đơn vị hiện tại qua JOIN |
| scan_point_id, point_name | string, điểm quét |
| movement_type | IN hoặc OUT |
| quantity_packages | number integer, số gói dương |
| conversion_factor_snapshot | number integer **đã lưu trên giao dịch** |
| quantity_base | string bigint **đã lưu/generated trong DB**, không tính lại bằng factor hiện tại |
| inventory_after | string bigint **đã lưu trên giao dịch** |
| created_at | string ISO 8601 |

JOIN theo FK kép để chọn đúng đơn vị của sản phẩm. Tên sản phẩm/đơn vị/điểm quét là tên hiện tại; schema chưa lưu snapshot tên. Quantity OUT vẫn dương, movement_type mang hướng nhập/xuất. Không JOIN users và không trả user_id, username, display_name, password_hash hoặc role.

Ví dụ các trường lịch sử đã đối chiếu trực tiếp PostgreSQL (không phải toàn bộ response):

```json
{
  "transaction_id": "aaaaaaaa-0000-4000-8000-000000000002",
  "product_id": "SP001",
  "movement_type": "OUT",
  "quantity_packages": 15,
  "conversion_factor_snapshot": 1,
  "quantity_base": "15",
  "inventory_after": "145"
}
```

## GET /scan-points

```http
GET /api/scan-points?page=1&limit=20
```

Chỉ page/limit. data[] gồm scan_point_id:string, point_name:string, is_active:boolean. Thứ tự scan_point_id ASC; gồm cả is_active=false.

## React + Ant Design

Không tạo frontend trong dự án Backend. Khi tích hợp dùng cùng origin hoặc dev proxy localhost `/api → http://127.0.0.1:3000`; chưa bật CORS. Không dùng no-cors để đọc JSON và không đổi Backend sang bind ngoài localhost.

| Ant Design Table | Dữ liệu API / xử lý |
| --- | --- |
| dataSource | response.data |
| rowKey | product_id cho products/inventory; transaction_id cho transactions; scan_point_id cho scan-points; product_unit_id cho units |
| pagination.current | response.pagination.page |
| pagination.pageSize | response.pagination.limit |
| pagination.total | response.pagination.total, không phải count |
| onChange | Gửi page/limit mới; giới hạn tùy chọn pageSize trong 1–100 |
| Thay tìm kiếm/bộ lọc | Reset page=1, giữ các bộ lọc khác; dùng URLSearchParams |
| Chi tiết sản phẩm/tồn kho | response.data là object; không gán trực tiếp vào dataSource |

Nên hủy/bỏ response cũ khi tìm kiếm nhanh để không ghi đè kết quả mới; hiển thị lỗi theo error.code, giữ bigint dạng chuỗi. Không filter/sort chỉ một trang để suy ra toàn bộ DB; API chưa hỗ trợ sort tùy chọn/lọc thời gian.

Các thuộc tính phân trang theo [Ant Design Pagination](https://ant.design/components/pagination/); cấu hình proxy nếu Frontend dùng Vite theo [server.proxy](https://vite.dev/config/server-options#server-proxy).

## Giới hạn

Chưa có auth, API ghi/users, lọc thời gian, sort tùy chọn, full-text/bỏ dấu, cursor pagination, kiểm chứng hiệu năng dữ liệu lớn. Count và page cùng snapshot trong một request; nhiều request trang có thể thay đổi khi hệ thống khác ghi đồng thời. Chỉ phục vụ môi trường localhost hiện tại.
