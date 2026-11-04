# Tích hợp React + TypeScript + Ant Design

Backend contract: [OpenAPI 3.1](openapi.json). Có **29 HTTP operations** thuộc 24 path templates trong danh sách yêu cầu. File [api-client.ts](api-client.ts) là ví dụ client/types dành cho trình duyệt; không tạo React app, frontend build hoặc UI trong nhiệm vụ này. Tài liệu hợp đồng không thay thế báo cáo kiểm thử runtime.

Nghiệm thu ngày 04/11/2026: 29/29 operations đã gọi thành công qua typed client trên PostgreSQL test và Redis thật. Xem [BACKEND_READINESS.md](../BACKEND_READINESS.md) để phân biệt kết quả môi trường test với schema/quyền database chính còn chờ triển khai.

## Kết nối và phiên

Dùng cùng origin hoặc development proxy `/api` từ frontend sang `http://127.0.0.1:3000`. Mở frontend bằng hostname nhất quán: `localhost` và `127.0.0.1` là hai origin/cookie host khác nhau. Backend giữ bind loopback; không dùng `no-cors`, không mở CORS `*` với credentials để chữa sai cấu hình.

Backend ALLOWED_ORIGINS phải chứa đúng origin frontend thực tế, ví dụ origin localhost của dev server được chủ dự án chọn. Origin gồm scheme, host và port, không có đường dẫn/trailing slash. Trình duyệt tự gắn Origin cho fetch POST/PATCH; không tự thêm header Origin vào API client trong browser. Reverse proxy phải giữ Origin và forwarded headers theo cấu hình tin cậy đã duyệt.

Luồng sử dụng:

1. `POST /api/auth/login` với JSON username/password; luôn `credentials: 'include'`. Backend tạo cookie HttpOnly/SameSite=Lax và Secure khi HTTPS. Response chỉ chứa identity, không chứa cookie token/hash/password.
2. `GET /api/auth/me` để khôi phục trạng thái khi reload; không lưu role/user_id do client tự khai báo để quyết định quyền. Role trả về chỉ phục vụ hiển thị UI; mọi quyền vẫn do backend kiểm tra.
3. `GET /api/auth/csrf` lấy token gắn với phiên; giữ token này trong bộ nhớ, gửi `X-CSRF-Token` cho POST/PATCH/logout. Client ví dụ tự lấy trước thao tác ghi đầu tiên.
4. Logout thu hồi phiên ở server và xóa cookie. Phiên idle 30 phút, absolute 8 giờ; không kéo dài absolute timeout bằng request mới. Redis demo restart không persistence khiến người dùng phải đăng nhập lại.
5. 401: bỏ trạng thái identity/CSRF và điều hướng login. 403: hiển thị không đủ quyền/Origin/CSRF theo error.code. Không tự retry thao tác ghi chỉ vì 403.

Password mới/reset: 12–128 ký tự, tối đa 512 UTF-8 bytes, không NUL; không trim/lowercase hoặc lưu vào localStorage/sessionStorage/log. Backend băm Argon2id với salt ngẫu nhiên, không trả hash. CSRF token không phải cookie session token và không phải credential PostgreSQL.

## Dùng client typed

Sao chép/import `WarehouseApi` và các types trong api-client.ts vào project frontend tương lai, hoặc generate client từ OpenAPI bằng công cụ được chọn riêng. Không có dependency frontend nào được cài ở backend này.

```ts
import { WarehouseApi, ApiError } from './api-client';
const api = new WarehouseApi('/api');

await api.login(username, password); // credentials nhập từ form, không hardcode
const me = (await api.me()).data;
const result = await api.listProducts({ page: 1, limit: 20, q: search });
```

Client giữ bigint và aggregate quantity dạng string, timestamp ISO UTC dạng string. Không `Number(id)` hoặc cộng số lượng bằng Number; chỉ dùng BigInt khi cần số nguyên chính xác và không đưa BigInt trực tiếp vào JSON.stringify.

Kiểu TypeScript hỗ trợ lúc biên dịch; backend vẫn validation và SQL parameterized. Client không tự thêm actor/user_id/role vào payload giao dịch. `user_id` trong path `/users/:id` là đối tượng quản trị, không phải actor thực hiện lệnh.

## Ant Design Table và Form

| Thành phần | Mapping |
| --- | --- |
| Table.dataSource | response.data |
| Table.rowKey | product_id / product_unit_id / transaction_id / scan_point_id / user_id tương ứng |
| pagination.current | response.pagination.page |
| pagination.pageSize | response.pagination.limit |
| pagination.total | response.pagination.total, không phải count |
| loading | true trước request, false trong finally |
| Khi đổi q/filter/pageSize | Reset page=1, giữ filter còn lại |
| Lỗi API | Đọc error.code/message, hiển thị qua message/notification hoặc Form.setFields phù hợp |

Dùng AbortController cho các GET khi người dùng tìm kiếm nhanh; bỏ kết quả request cũ để tránh ghi đè bảng hiện tại. Không sort/filter một trang ở browser rồi suy ra kết quả toàn DB. API chỉ nhận các query có trong OpenAPI, không có tham số sort tự do cho những list cũ.

PATCH phải chứa ít nhất một field được hỗ trợ, không gửi toàn bộ object lấy từ GET kèm created_at/ID/internal fields. Tách form status theo route status. User management/catalog writes chỉ ADMIN. Đơn vị quy đổi đang có không được đổi factor/is_base_unit/scan_code/product binding; để đổi ý nghĩa phải tạo đơn vị/mã quét mới, giữ lịch sử. Product.base_unit chỉ đổi khi chưa có units/history/nonzero inventory.

## Giao dịch kho và retry

Tạo UUID v4 đúng **một lần cho một hành động đã xác nhận**, giữ request object trong state pending. Retry timeout/mất kết nối dùng đúng object/UUID đó:

```ts
const pending = {
  transaction_id: crypto.randomUUID(),
  scan_point_id: selectedPoint,
  scan_code: scannedCode,
  movement_type: 'OUT' as const,
  quantity_packages: packageCount,
};

try {
  const result = await api.recordTransaction(pending);
  // CREATED hoặc DUPLICATE đều là kết quả của cùng một nghiệp vụ đã commit.
  // result.data.inventory_after là snapshot của giao dịch, không phải luôn là tồn hiện tại.
} catch (error) {
  if (error instanceof ApiError && error.code === 'TRANSACTION_OUTCOME_UNKNOWN') {
    // Giữ pending để retry cùng UUID; không sinh UUID mới.
  }
  throw error;
}
```

Disable nút submit khi request đang chạy để giảm double-click, nhưng không coi đó là cơ chế chống trùng chính. Hai UUID khác nhau là hai nghiệp vụ dù cùng payload. 409 IDEMPOTENCY_CONFLICT yêu cầu sửa luồng pending, không tự đổi UUID để lách xung đột. 409 INSUFFICIENT_INVENTORY là lỗi nghiệp vụ, không retry tự động. 503/HTTP timeout không chứng minh DB rollback. Client ví dụ không tự retry bất kỳ thao tác ghi nào.

Admin create/reset password cũng không tự retry mù khi mất response; kiểm trạng thái đích trước khi thực hiện một yêu cầu thay đổi mới. Sau self-reset hoặc đổi role/status, session có thể bị thu hồi; frontend xử lý 401 ở request tiếp theo.

## Dashboard và ngày/tháng

- Summary không có grand total cộng item/kg/...; hiển thị một KPI/series cho từng base_unit trong inventory_totals. Những nhãn base_unit giống nhau là đơn vị tương đương duy nhất schema hiện tại biết, chưa có dimensional-unit conversion.
- Summary products/transactions/low-stock counts đều là string. Hiển thị string trực tiếp; nếu thư viện chart đòi number, chỉ chuyển sau khi kiểm giá trị nằm trong vùng an toàn và xác nhận dữ liệu là count phù hợp.
- Low-stock dùng threshold string mặc định `"10"`, strict `<`. Không coi missing inventory là tồn 0; summary báo riêng missing_inventory. Threshold áp theo đơn vị cơ sở riêng của từng sản phẩm, không phải ngưỡng tiền/tổng gói.
- Trends dùng from/to **YYYY-MM-DD UTC**, cả hai đầu bao gồm, tối đa 366 ngày; granularity day/month. Hiển thị rõ nhãn UTC khi date picker/người dùng ở Asia/Bangkok để không dịch sang ngày khác do timezone browser.
- Trends chỉ có transaction counts IN/OUT/total; bucket rỗng có count 0 từ dữ liệu không có giao dịch, không phải giao dịch seed giả. Đọc đủ trang khi vẽ chart; limit tối đa 100.
- Top-products có count và lượng IN/OUT theo từng product/base_unit. Sort mặc định transactions; inQuantity/outQuantity bắt buộc baseUnit để không so lượng khác loại. Không cộng quantity_in_base/quantity_out_base giữa những hàng có đơn vị khác nhau.

## Lỗi và trạng thái vận hành

| HTTP | Hành động UI |
| --- | --- |
| 400 | Sửa input/query/path; giữ thông báo kiểm tra tại form |
| 401 | Đăng nhập lại; không retry ghi trong nền |
| 403 | Hiển thị thiếu quyền hoặc lỗi Origin/CSRF; kiểm cấu hình/token |
| 404 | Resource không tồn tại; refresh danh sách |
| 409 | Xử lý xung đột/nghiệp vụ theo code, gồm last active ADMIN và unsafe unit changes |
| 413/415 | Kiểm giới hạn body JSON/Content-Type |
| 422 | Mã quét/điểm quét/sản phẩm không hợp lệ hoặc inactive cho nghiệp vụ mới |
| 429 | Tôn trọng Retry-After, không spam login |
| 500 | Thông báo lỗi server chung; không hiển thị SQL/stack nếu proxy trả bất thường |
| 503 | Dịch vụ chưa sẵn sàng; với giao dịch giữ UUID/pending nếu cần retry |

Health chỉ là DB SELECT 1 trên localhost, không chứng minh Redis/ACL/schema/migration đầy đủ. Trước khi nối frontend vào DB chính, chủ dự án vẫn phải duyệt SQL/quyền/credential rollout tương ứng và xem báo cáo test thật. Không dùng OpenAPI hoặc type client làm bằng chứng rằng mọi endpoint đã PASS integration.
