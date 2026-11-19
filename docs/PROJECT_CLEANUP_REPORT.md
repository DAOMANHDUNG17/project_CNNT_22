# Rà soát dọn dẹp dự án Smart Warehouse

**Trạng thái BLOCKED.** Đã xác minh sáu log build có thể dọn và sao lưu đầy đủ. Windows trả `PermissionDenied` khi xóa từng file, nên danh sách đã xóa hiện rỗng. Không thay quyền truy cập để vượt qua lỗi này. Mã nguồn, cấu hình, tests và các thay đổi chưa commit đều được bảo toàn.

## Phạm vi và số lượng

Rà repository ngày 20/11/2026, gồm file tracked, untracked và ignored. Số liệu theo danh sách của Git, tính cả các file trong `node_modules` và loại trừ metadata `.git`. Nội dung bộ cài được kiểm kê theo thư mục, vì các package và lockfile đang tham gia build hoặc test. Bản build và kết quả Playwright lần này nằm trong thư mục tạm riêng ngoài repository.

| Loại | Trước | Sau nỗ lực dọn | Sau khi thêm báo cáo |
| --- | ---: | ---: | ---: |
| Tracked | 234 | 234 | 234 |
| Untracked | 15 | 15 | 16 |
| Ignored | 48.907 | 48.907 | 48.907 |
| Tổng số file theo Git | 49.156 | 49.156 | 49.157 |

Trong các file tracked hoặc untracked trước rà soát có 14 Markdown, 35 ảnh và 3 tài liệu TXT là giấy phép hoặc thông báo kèm asset. Đã đối chiếu SHA-256 của 35 ảnh và không thấy cặp trùng nội dung. Sau nỗ lực dọn, số Markdown, ảnh, tài liệu và file tạm/cache đã xóa đều bằng **0**. Dung lượng thực giảm **0 byte**. Sáu log được đề xuất chiếm **58.604 byte** trong workspace. ZIP sao lưu chiếm **12.051 byte** ngoài repository.

### Cấu trúc trước và sau

| Khu vực | Vai trò và trạng thái sau rà soát |
| --- | --- |
| `backend/src`, `backend/test` | NestJS, Swagger, xác thực, nghiệp vụ, unit và e2e giữ nguyên. Thư mục `backend/.git` là metadata của một Git root lồng, được bảo toàn. |
| `frontend/src`, `frontend/config`, `frontend/scripts`, `frontend/tests` | React, cấu hình LAN/Vite, entry point chạy và kiểm thử giữ nguyên. |
| `frontend/public`, `frontend/swagger` | Giữ favicon, giấy phép và Swagger tĩnh. Các file public có thể được gọi qua URL trực tiếp. |
| `frontend/artifacts`, `frontend/test-results` | Giữ ảnh giao diện và metadata test. |
| `docs` | Giữ tài liệu vận hành, SQL, báo cáo, ảnh minh chứng và collection KT2. Thêm báo cáo này. |
| `node_modules`, `backend/dist`, `frontend/dist` | Giữ module cài đặt, cache và build output mà các tiến trình hoặc lệnh chạy dự án có thể sử dụng. |

## Phân loại và kiểm tra phụ thuộc

| Nhóm | Quyết định |
| --- | --- |
| **A — Bắt buộc giữ** | Source, controller/service/DTO/guard, React, các cấu hình Nest/Vite/Playwright/Vitest, lockfile, templates môi trường, tests, SQL KT3, Postman KT2 và minh chứng. Hai trang HTML tham chiếu `/favicon.svg`. Vite đọc `docs/openapi.json` và `docs/AN_FRONTEND_HANDOFF.md` để xuất route tài liệu, dù đây là đặc tả cũ. |
| **B — Có thể xóa sau khi có quyền filesystem** | Sáu log build ở bảng dưới. Chúng là kết quả build Vite đã hoàn tất, bị Git ignore và chưa có trong lịch sử Git. Đã dò cả tên file lẫn tiền tố qua source, config, script, tài liệu và tests. Không có cấu hình CI/Docker tracked tham chiếu các log. Đã mở kiểm tra không có writer giữ file trước khi sao lưu. |
| **C — Cần xem xét nếu dọn thêm** | `frontend/e2e-run.log` là kết quả kiểm thử cũ. `frontend/artifacts` có thể là ảnh nghiệm thu, còn `frontend/test-results/.last-run.json` là metadata của Playwright. `docs/api-client.ts` và tài liệu tham khảo có thể còn người dùng ngoài source. Hai liên kết skill dưới `skills/` có target không đọc được, mục đích do công cụ quản lý. Giữ tất cả do chưa đủ bằng chứng. |
| **D — Quan trọng hoặc nhạy cảm** | Các file môi trường, chứng chỉ nếu có, hai Git root, dữ liệu backup và các file của tiến trình đang chạy. Chỉ xem loại file, trạng thái Git và quyền cần thiết. Bản backup KT3 gốc được đối chiếu SHA-256 trước và sau restore QA. |

Đã ghi nhận 17 file modified và 15 file untracked ban đầu. So sánh SHA-256 theo tập 32 đường dẫn cho kết quả giống hệt sau rà soát. Working tree đang có công việc chưa commit, nên giữ nguyên nhánh và index. Báo cáo này là file repository duy nhất được thêm trong lượt dọn.

## Danh sách đã xóa và các file đang bị chặn

**Danh sách đã xóa thực tế trống.** Cả sáu file vẫn tồn tại, có SHA-256 khớp bản sao lưu. Lỗi hệ thống là `UnauthorizedAccessException` dù file không có thuộc tính chỉ đọc.

| File | Vị trí | Lý do có thể xóa | Bằng chứng không sử dụng | Khả năng khôi phục |
| --- | --- | --- | --- | --- |
| `build-login-layout.log` | `frontend/` | Log build thử bố cục đăng nhập | Kết quả build hoàn tất, không có consumer theo tra cứu tên và tiền tố | ZIP đã xác minh SHA-256 |
| `build-login-ratio.log` | `frontend/` | Log build thử tỷ lệ màn hình đăng nhập | Cùng tiêu chí, không phải fixture, build output hoặc minh chứng KT | ZIP đã xác minh SHA-256 |
| `build-login.log` | `frontend/` | Log build cũ của trang đăng nhập | Kết quả build hoàn tất, không tham gia npm scripts hoặc Vite | ZIP đã xác minh SHA-256 |
| `build-redesign.log` | `frontend/` | Log build lần chỉnh giao diện cũ | Không thấy tham chiếu từ source, script, tài liệu hoặc test | ZIP đã xác minh SHA-256 |
| `build-sidebar.log` | `frontend/` | Log build thử sidebar | Không thấy tham chiếu từ source, script, tài liệu hoặc test | ZIP đã xác minh SHA-256 |
| `build-unit-cells.log` | `frontend/` | Log build thử cách hiển thị đơn vị | Không thấy tham chiếu từ source, script, tài liệu hoặc test | ZIP đã xác minh SHA-256 |

## Kết quả kiểm thử sau nỗ lực dọn

| Kiểm tra | Kết quả |
| --- | --- |
| NestJS build | Đạt với đầu ra riêng ngoài repo, giữ nguyên `backend/dist` đang dùng. |
| Backend unit test | **20 đạt**. |
| Backend e2e | **369 đạt**, gồm bốn database PostgreSQL 17 QA riêng cho stock, access, history và users. Hai test Supabase-hosted cần môi trường QA được cấp sẵn. |
| Frontend typecheck và Vite build | Đạt với đầu ra ngoài repo. Favicon, giấy phép, OpenAPI tĩnh và handoff trong bản build khớp từng byte với source. Frontend hiện chưa có script ESLint. |
| Frontend unit test | Chạy toàn bộ **65 ca**, **64 đạt**, **1 lỗi** ở `multi-host.test.ts` do frontend đang giữ cổng 5173. Tiến trình hiện tại được giữ nguyên. |
| Frontend Playwright | **77 đạt**, **1 ca đăng nhập Supabase thật tự bỏ qua** vì thiếu tài khoản QA cho ca live. Những ca còn lại dùng cấu hình loopback và fixture. |
| Smoke test chỉ đọc | Backend `/api/health` trả 200 và `connected`. Swagger UI và JSON trả 200, JSON hợp lệ OpenAPI 3.0, còn route nhập/xuất, replay, tồn và lịch sử. Các GET cần phiên trả 401 nếu thiếu JWT. Frontend và các asset quan trọng trả 200. |
| KT1, KT2, phân quyền, danh mục và lịch sử | E2E QA xác minh nhập/xuất, 201 → 200 → 409, quyền ADMIN/STAFF/VIEWER, phân công điểm quét, danh mục, tồn và lịch sử. |
| KT3 backup/restore | `pg_restore` kiểm tra được catalog và restore sang database QA riêng. SQL KT3 chạy trong transaction chỉ đọc. Kết quả có 17 sản phẩm, 17 dòng tồn, 17 giao dịch và 5 tài khoản. Không có khóa ngoại chưa hợp lệ hoặc giao dịch sai công thức. SHA-256 của archive gốc giữ nguyên. |

Các ca ghi chạy trên QA hoặc mock. Không có request ghi lên Supabase Production. Lỗi cổng 5173 xảy ra khi chạy bộ test hiện có, trước bất kỳ thay đổi source hay xóa file nào.

## Khôi phục

Bản phục hồi: [ZIP chứa sáu log](C:/Users/Admin/AppData/Local/SmartWarehouse/CleanupRecovery/vite-logs-220810b4dfdd459697c252e3f44fceb4.zip). Nội dung từng entry đã được so SHA-256 với file gốc. Hiện tại cả sáu file còn đầy đủ. Nếu cần khôi phục sau một lượt dọn khác, mở ZIP vào thư mục tạm rồi chép riêng file còn thiếu về `D:\Project_CNNT\frontend`. Giữ file hiện tại nếu đã có phiên bản mới hơn. Source, Git index và dữ liệu nghiệp vụ không cần khôi phục.
