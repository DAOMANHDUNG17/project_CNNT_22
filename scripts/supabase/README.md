# Cloud SQL review package

**IMPLEMENTED: artifacts for review. NOT TESTED: PostgreSQL execution. BLOCKED: deployment.** Không file nào trong thư mục này đã được chạy bằng psql. Không có kết nối đã thực hiện, password/user mặc định hoặc migration tự động.

**Cập nhật:** người dùng cho biết đã tạo dữ liệu Cloud. Các file10–80 là candidate cho schema mới và có guard từ chối object/role tồn tại, không phải upgrade script cho database hiện hữu. Cần catalog inventory và delta plan trước bất kỳ migration nào. `preflight.js` là diagnostic kết nối READ ONLY được chuẩn bị sau đó, chưa chạy và hiện chưa được phép kết nối theo yêu cầu gần nhất.

Tất cả `.psql` gọi `review-gate.psql`, kết thúc với exit code 3 trước mutation. `80-assertions.psql` còn chủ động báo lỗi về password lifecycle/staging chưa xác minh. D8 đã duyệt code, chưa chạy. Không bỏ chốt này chỉ để chạy thử. `00`, `95` và `preflight.js` là read-only nhưng vẫn cần phê duyệt kết nối mới theo yêu cầu gần nhất.

## Thứ tự review và thực hiện tương lai

| Thứ tự | File | Nội dung / giới hạn |
| --- | --- | --- |
| 0 | `00-preflight-readonly.sql` | Catalog, TLS, role/membership, default ACL, Auth columns; không đọc business/Auth rows |
| 1 | `10-roles.psql` | Năm role NOLOGIN, không tái dùng role đã tồn tại, postgres creator defaults scoped public |
| 2 | `20-schema.psql` | Sáu bảng cuối cùng, auth_version, request_scan_code, constraints/index/identity/trigger |
| 3 | `30-auth-mapping.psql` | UUID→bigint mapping, cutoff trigger, session và limiter tables |
| 4 | `40-stock-function.psql` | Nguyên định nghĩa hardened stock; đổi owner qua capability tạm thời |
| 5 | `50-admin-function.psql` | Giữ catalog/user profile/status logic; chặn sớm create/reset Cloud |
| Gate | `55-provider-contract.md` | D8 đã duyệt source; password/provider lifecycle còn chặn |
| 5b | `55-provider-bridge.psql` | Hàm đọc session timestamps duy nhất owner postgres trong warehouse_private |
| 6 | `60-session-functions.psql` | Candidate admission/revocation/limiter; dùng bridge D8 |
| 7 | `70-grants.psql` | Grants tối thiểu; không hash, không cấp Auth schema; gỡ SET membership do postgres cấp |
| 8 | `80-assertions.psql` | Pre-commit assertions và blocker rõ ràng; chưa thể PASS |
| 9 | `90-seed.psql` | No-op có guard; chưa có provisioning/seed được duyệt |
| 10 | `95-verification-readonly.sql` | Xuất catalog để đối chiếu manifest sau approval |
| Sự cố | `99-containment.psql` | Candidate NOLOGIN/revoke chức năng, không xóa dữ liệu |

Sau khi D8/password lifecycle và staging được duyệt, cần một migration runner mới: kiểm endpoint/project ngoài SQL, `psql -X` với ON_ERROR_STOP, một transaction cho 10–80, lock/statement deadlines, rollback tự động khi bất kỳ assertion nào sai. Chưa viết runner triển khai vì chưa đủ điều kiện. Không gọi các file lẻ khiến object/default privileges lộ giữa các commit. Các role giữ NOLOGIN cho đến bước cấp credential riêng; không ALTER ROLE PASSWORD bằng literal trong source/terminal history.

## Provenance và phạm vi

`prepare-business.js` chạy **offline**: chỉ trích definition đã kiểm thử từ source hiện hành, không copy test guard/bootstrap/fixtures. Sinh 20/40/50; ghi SHA256 source definition. `--check` phát hiện drift. Stock body được kiểm thử so sánh byte sau chuẩn hóa CRLF. Admin có đúng một early blocker trước xử lý action; không giả vờ hash local là mật khẩu Auth.

Sáu bảng baseline có 37 cột; mapping thêm 3 cột vào users → 40 cột nghiệp vụ. Hai bảng phụ có 12 cột tổng cộng. Candidate có 8 bảng, 20 indexes (bao gồm PK/UNIQUE), 8 foreign keys, 16 CHECK, 2 triggers, 2 identity sequences. Đây là số từ source, **chưa đối chiếu catalog thực tế**. Business history và request_scan_code không backfill; không thay IDs.

Owner bảng/sequences: postgres. Owner hai business functions: stock/admin executor. Ba session/rate functions: auth executor NOLOGIN. Hai trigger helpers INVOKER. Bridge D8 trong schema warehouse_private là hàm DEFINER owner postgres duy nhất được bổ sung trong source, chưa chạy SQL. Không dùng RLS để thay ACL: Data API tắt, API roles không có quyền warehouse, runtime không được DML trực tiếp, executors có column grants hẹp. Nếu bật Data API/RLS sau này phải review lại, không mặc nhiên an toàn.

Default privileges: chỉ đổi creator postgres trong public cho ba API roles; không sửa defaults của Auth/Storage creators. Global PUBLIC EXECUTE vẫn được xử lý bằng REVOKE trên từng function trong cùng transaction; schema-level REVOKE không triệt tiêu global default. Mọi migration sau phải giữ điều này. Không revoke PUBLIC TEMP, không thu hồi default quyền quản trị của provider, không GRANT ALL.

## Các điều kiện chưa đạt

- D8 giải quyết thiết kế quyền Auth schema qua bridge đã duyệt; source/checker có negative tests. Quyền provider thực tế và session helper SQL chưa được xác minh, chưa phải bộ migration sẵn sàng triển khai.
- Chưa có provisioning saga/password lifecycle, import dữ liệu, bootstrap ADMIN hay seeds.
- Chưa có evidence SQL syntax/permissions/concurrency/rollback trên PostgreSQL 17.11. Kiểm tra source không chứng minh transaction semantics.
- Owner transfer/role GRANT/REVOKE phải kiểm bằng catalog sau từng bước; warning không phải thành công. Hạn chế connection cần tính lại với quotas Cloud thực.
- Staging cần adversarial tests (public/API/executor/runtime, temp-shadowing, UUID replay, concurrent IN/OUT, last-admin, expire/revoke/clock/limiter capacity).

Chi tiết [runbook](../../docs/SUPABASE_RUNBOOK.md), [security review](../../docs/SUPABASE_SECURITY_REVIEW.md), [trạng thái](../../docs/SUPABASE_IMPLEMENTATION_STATUS.md).
