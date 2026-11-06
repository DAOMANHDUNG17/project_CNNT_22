# Provider session bridge — D8 approved for source

Chủ dự án đã duyệt code D8 ngày 05/11/2026 và xác nhận tiếp tục chỉ source/offline trong yêu cầu mới nhất. `55-provider-bridge.psql` và strict checker đã được viết; `60-session-functions.psql` gọi bridge. Không cấp quyền vào schema managed `auth`, không migration/kết nối. **Chưa xác minh triển khai thực tế.**

Ngày 05/11/2026, tài liệu chính thức Supabase xác nhận custom role không nhận được USAGE `auth` từ `postgres`: GRANT có thể chỉ phát warning và không có hiệu lực. Provider đề xuất một hàm đọc rất hẹp, SECURITY DEFINER do `postgres` sở hữu trong schema private. Thêm membership `authenticated` là một lựa chọn khác của provider nhưng không phù hợp policy dự án vì kéo theo quyền không cần thiết. [Supabase: custom role access to auth](https://supabase.com/kb/troubleshooting/permission-errors-when-granting-custom-roles-access-to-the-auth-schema-9e32e7).

Phát hiện này làm giả định cấp SELECT/USAGE trực tiếp cho NOLOGIN identity executor trong D3 chưa khả thi. Không đổi owner của toàn bộ session gate/business function thành postgres để lách giới hạn.

## D8 đã triển khai trong source, chưa triển khai database

- Tạo schema riêng `warehouse_private`, owner postgres, không nằm trong exposed schemas. Không dùng schema private của ứng dụng/provider khác.
- Một hàm SQL nhỏ, không dynamic SQL, không ghi/khóa Auth rows, SECURITY DEFINER owner postgres, `search_path=''`; nhận đúng subject UUID + session UUID, trả tối đa một dòng gồm created_at và not_after. Chỉ đọc `auth.sessions` với cả hai khóa. Không trả hash/token/email hay metadata.
- EXECUTE chỉ cho `warehouse_auth_executor`; USAGE schema chỉ cho executor này. PUBLIC, API roles và hai runtime không được EXECUTE/USAGE; executor không có quyền đổi function/schema.
- Hàm `resolve_cloud_principal` vẫn thuộc NOLOGIN executor, đổi phần đọc sang bridge. Mở rộng checker để kiểm exact signature/body fingerprint/owner/path/ACL của duy nhất bridge; mọi business function giữ policy owner cũ.
- Đây là ngoại lệ owner đặc quyền đã được duyệt bổ sung, chỉ áp dụng cho bridge đọc phiên này. Negative/source tests đã có; staging quyền âm/tampering và xác minh provider-supported deployment vẫn cần trước activation. Đọc catalog không thể thay thế test effective privileges.

## Password lifecycle vẫn là blocker độc lập

Bridge chỉ giải quyết visibility phiên. Nó không chứng minh rằng đổi mật khẩu (SDK ngoài UI, reset Admin, recovery) xóa tất cả `auth.sessions`, kể cả phiên hiện tại. JWT cũ có thể vẫn còn hạn. Cần pin phiên bản/cấu hình provider và chứng minh hành vi bằng staging synthetic accounts; nếu không bảo đảm thì thiết kế thêm cơ chế authoritative revocation event/cutoff trước khi triển khai password flows. Không dựa vào callback frontend, updated_at chung của Auth user hay raw metadata.

Provisioning saga cần operation ledger/idempotency, pending/ready/blocked, xử lý timeout không rõ outcome, đối soát UUID và cuối cùng mới kích hoạt application mapping. Chưa có service role key trong runtime này; không cấp đặc quyền đó chỉ để xác minh JWT.
