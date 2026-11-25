# Phạm vi commit demo và quản lý mật khẩu

25/11/2026. Người dùng cho phép commit và push nhánh deploy/cloud-readiness. Danh sách mới gồm **45 file** tại [DEMO_COMMIT_FILES.txt](DEMO_COMMIT_FILES.txt), thêm README gốc để đồng bộ npm run dev và hướng dẫn trùng cổng. Đây là phần thay đổi so với baseline; source đã tracked vẫn được triển khai đầy đủ.

- Giữ cấu hình cloud và tài liệu demo đã chọn.
- Thêm AccountModule, DTO, dịch vụ mật khẩu/giới hạn tần suất, API Auth chính thức; UsersModule chỉ export transport có sẵn. Không sửa UsersService, UsersController, JWT/RolesGuard hoặc nghiệp vụ kho.
- Thêm Settings, modal ADMIN, account dropdown, API client và xử lý đăng xuất sau đổi mật khẩu. Không tiếp tục refactor Auth đã hoãn.
- Thêm unit/HTTP/browser tests; cập nhật kiểm tra Swagger từ 20 thành 23 operations vì có ba API mới. Không sửa kỳ vọng nghiệp vụ KT1–KT3.
- Không thay dependency hoặc lockfile. Backend đổi script start thành dev (nest start --watch); start:prod giữ nguyên.

## Loại khỏi commit

Không chọn docs/security-hardening/**, docs/security-qa/**, docs/demo-readiness/** hoặc báo cáo MASTER/Audit cũ ngoài manifest. Giữ nguyên các tệp này để tra cứu. Không chọn SQL, migration, QA helper, dữ liệu backup, .env thật, key/cert/passfile, log, test-results, dist/cache hoặc node_modules. Không dùng git add . hay git add -A.

Trước stage, index được kiểm tra rỗng. Chỉ stage chính xác 45 đường dẫn trong manifest, không dùng add tất cả. Audit đối chiếu staged names và nội dung từng blob, quét secret trong bộ nhớ, kiểm frontend build không mang key quản trị hoặc mock và đối chiếu KT1–KT3/JWT/RBAC với baseline 992845e. Bằng chứng được giữ ngoài project tại D:\SmartWarehouse-Demo-Readiness-2026-11-25.

Commit dùng đúng message [DEMO_COMMIT_MESSAGE.md](DEMO_COMMIT_MESSAGE.md): feat: prepare Smart Warehouse for cloud deployment. Push chỉ refs/heads/deploy/cloud-readiness lên origin, không force, không tags, không merge main. Xác minh HEAD Local, origin/deploy/cloud-readiness và git ls-remote trùng nhau; so main và object tag trước/sau.

Kết quả mật khẩu thực tế được ghi đúng 13/14 PASS theo người dùng, một tiêu chí chưa xác minh thủ công; không kết luận 14/14. Cho phép commit/push không đồng nghĩa đã nghiệm thu toàn bộ cloud hoặc cho phép deploy. Dừng sau khi push và xác minh thành công.
