# Smart Warehouse · Demo BTL Đề tài 22

**25/11/2026 · Source/build PASS · Có thể chuẩn bị deploy demo có điều kiện, chờ quyết định của người dùng.**

**Cập nhật trước commit/push ngày 25/11/2026:** kết quả bên dưới là mốc lịch sử. [Báo cáo mật khẩu mới nhất](ACCOUNT_PASSWORD_MANAGEMENT_REPORT.md) ghi đúng 13/14 PASS theo người dùng, một tiêu chí chưa xác minh thủ công; chưa có tên tiêu chí còn lại để gán kết quả chi tiết. Data API Off và website hoạt động đã được người dùng xác nhận. Allowlist hiện 45 file; người dùng đã cho phép commit/push deploy/cloud-readiness, chưa deploy. Xem gate và manifest mới nhất.

Phạm vi hiện tại là demo riêng tư, giới hạn người tham gia và thời gian mở dịch vụ. Không kết luận hệ thống đã đạt chuẩn vận hành công khai. Supabase QA đầy đủ, runtime role mới và Auth refactor được hoãn theo chỉ đạo mới, không còn là điều kiện bắt buộc của bản demo này.

## 1. Source deploy đã chốt lại

Nhánh vẫn là `deploy/cloud-readiness`, HEAD/tag baseline tại `992845e8d72600041ff63eb819f1a7d32316e133`. Giữ source nghiệp vụ đã đạt KT1–KT3 cùng cấu hình cloud D1.3/D1.4.

Đã khôi phục chính xác năm tệp trước MASTER TASK, có đối chiếu checksum với snapshot trước đó.

- `backend/src/users/users.service.ts` dùng Auth SQL ổn định trước refactor.
- `backend/src/main.ts` giữ HOST/PORT/CORS/HTTPS, bỏ phụ thuộc startup vào schema private.
- `backend/src/main.spec.ts` giữ test cấu hình D1.3.
- `backend/test/users.e2e-spec.ts`, `backend/test/users.postgres.e2e-spec.ts` trở về contract/fixture cũ.

Tệp test startup của Auth refactor đã được lưu ngoài project rồi bỏ khỏi source demo. Auth refactor, startup gate, SQL và helper hardening hiện tại đều được sao lưu tại `D:\SmartWarehouse-Demo-Readiness-2026-11-25`. Bản cũ MASTER và toàn bộ kết quả QA vẫn còn.

Không có `warehouse_private`, `warehouse_app` hoặc `assertAuthReadBoundary` trong source backend đang deploy và compiled main/UsersService. Các tệp SQL trong docs là tài liệu hoãn, không nằm trong artifact runtime frontend/backend và không được gọi bởi npm build/start. Không đặt migration vào Render Pre-Deploy Command.

Các thư mục stock-movements, inventory, auth, UsersService và UsersController khớp HEAD bằng `git diff --exit-code`. Không thay logic KT1–KT3 hoặc phân quyền. Cấu hình Vercel có `X-Robots-Tag: noindex, nofollow, noarchive`, không phải kiểm soát truy cập. Ở FINAL SECURITY GATE đã bỏ import/export mock không được UI dùng trong barrel frontend để dữ liệu mẫu không đi vào artifact production. 27 test liên quan, typecheck và build lại đã PASS. Không chạy lại toàn bộ các suite cũ.

## 2. Kết quả kiểm tra thực tế

| Kiểm tra | Kết quả |
| --- | --- |
| Backend build | Exit 0, tạo lại dist của source ổn định |
| Backend unit | **44 PASS, 0 FAIL**, 7 suite |
| Frontend unit | **87 PASS, 0 FAIL**, 17 tệp |
| Backend HTTP e2e với doubles | **301 PASS, 0 FAIL**, 7 suite |
| Regression dịch vụ với PostgreSQL Local QA hiện có | **6 nhóm PASS, 0 FAIL** |
| Frontend production build | Typecheck + Vite exit 0, output `frontend/dist` |
| Secret / env / lockfile / source checksum | PASS, quét 285 tệp gồm 47 tệp frontend artifact. Năm source file khớp snapshot trước MASTER, `.env` và lockfile không đổi |
| Local runtime cuối | Backend health 200, database connected, không JWT 401, preflight Local 204, frontend 200 |

Sáu nhóm SQL thực kiểm tra trigger tạo tồn và identity đơn vị, nhập 2 hộp × 6, xuất kho, từ chối vượt tồn, replay UUID không đổi dữ liệu, payload khác 409, ba request cạnh tranh chỉ ghi một lần, VIEWER không được ghi và UsersService cũ đọc Auth/kiểm tra duplicate đúng. Mọi fixture đều tổng hợp và chỉ ghi vào QA tại loopback 55433. Không tạo cluster, role hoặc migration mới. Các fixture được giữ, không reset hoặc xóa dữ liệu cũ.

Regression này dùng runtime owner **trên QA** để khớp phương án demo ổn định. Không lấy kết quả warehouse_app của MASTER làm bằng chứng cho build demo. Auth/Admin transports thật và đăng nhập cloud chưa kiểm tra lại. Unit/HTTP doubles không được coi là Supabase thực tế.

Frontend build dùng origin và public key fixture được đặt trong môi trường tiến trình, không sửa `.env`. Các origin `.example.test` không phải domain được cấp. Phải build lại trên Vercel bằng origin Render/Supabase thật. Cảnh báo chunk lớn hơn 500 kB vẫn còn, build exit 0. Không cài dependency mới hoặc Docker.

Đã tạm dừng đúng dev server để tránh test cổng 5173 xung đột, rồi khôi phục lại. Khi kiểm tra cuối, cổng 3000 không có listener nên đã khởi động lại backend Local bằng compiled source ổn định, bind loopback và giữ credential hiện có. Health xác nhận kết nối Supabase thật, API thiếu JWT trả 401 và preflight Authorization trả 204. Đây là kiểm tra Local development, không phải smoke tại Render/Vercel.

## 3. Backup và Supabase hiện tại

Đã tạo `business-public-pre-demo.backup` mới ngoài project, kích thước **33.350 byte**, chứa bảy bảng nghiệp vụ, schema/functions/triggers/constraints/ACL trong public. `pg_dump` dùng `default_transaction_read_only=on`; catalog cũng đọc trong READ ONLY. `pg_restore --list` và đọc giải nén toàn bộ archive ra NUL đều exit 0. Checksum được lưu trong `live-backup-verification.json`.

Không restore archive này vào database nào. Đây không phải backup toàn bộ Auth/Storage, và restore public trên một database trống cần xử lý FK tới managed auth.users. Không export auth.users thật sang QA, không ghi hoặc thay schema/grants/RLS trên Supabase chính. Archive có dữ liệu nghiệp vụ nên được bảo vệ bằng ACL chỉ cho tài khoản Windows hiện tại và SYSTEM, không đưa vào Git.

Catalog thực tế có PostgreSQL 17.11, bảy bảng public bật RLS, 0 policy, runtime vẫn là postgres có BYPASSRLS. Schema private và warehouse_app chưa tồn tại trên Supabase chính. Query Auth cũ được kiểm tra quyền/khả năng lập kế hoạch bằng LIMIT 0, không xuất danh sách tài khoản.

## 4. Rủi ro bắt buộc xử lý trước khi chia sẻ demo

| Hạng mục | Điều kiện tối thiểu |
| --- | --- |
| Secret | DATABASE_URL và Service Role Key chỉ ở Render secret settings. Frontend chỉ có URL và key publishable/anon. Không chia sẻ `.env`, backup, SQL logs hoặc token |
| Dữ liệu | Chỉ trình diễn dữ liệu phù hợp cho lớp học. Không mở quyền xem dữ liệu cá nhân nhạy cảm cho khán giả. Giữ backup mới và kế hoạch quay lại source cũ |
| Tài khoản | Chỉ tài khoản đã cấp, mật khẩu riêng đủ mạnh. ADMIN do chủ dự án giữ. Dùng STAFF cho thao tác demo và VIEWER cho người chỉ xem. Không chia sẻ ADMIN công khai |
| JWT/phân quyền | Giữ kiểm chữ ký, issuer/audience/expiry và đối chiếu profile active/role từ database. Không bỏ guard, không thêm anonymous write hoặc tài khoản admin mặc định |
| HTTPS/CORS | Render HOST 0.0.0.0, PORT do nền tảng cấp. FRONTEND_URL là đúng một origin HTTPS. Không wildcard, không nới mọi domain Vercel, giữ Authorization/preflight |
| Data API | Ưu tiên tắt Data API trong Dashboard vì source nghiệp vụ chỉ đi qua NestJS, frontend dùng Supabase Auth. Xác nhận Auth và backend SQL vẫn hoạt động sau cấu hình. Chưa thực hiện thay đổi Dashboard này |
| Chia sẻ frontend | Bật Vercel Authentication với All Deployments nếu project hỗ trợ, kiểm cả production domain và deployment URLs. Nếu người xem không được cấp quyền phù hợp, chủ dự án trình chiếu bằng phiên của mình |
| Khung demo | Không quảng bá link công khai, chỉ mở dịch vụ trong thời gian cần thiết, theo dõi lỗi và tạm dừng Render khi xong. Không coi URL khó đoán là bảo vệ |

Supabase hướng dẫn tắt Data API khi không dùng REST/GraphQL nghiệp vụ. Đây là cấu hình nền tảng, không phải migration SQL. Trước khi đổi cần kiểm cả ứng dụng/tích hợp ngoài repository nếu có. Không tắt Auth hoặc database connection. Nếu giữ Data API, phải kiểm chứng riêng anon/authenticated không đọc/ghi bảy bảng và không có RPC mở ngoài thiết kế, không chỉ dựa vào bảo vệ Vercel. [Supabase Securing your API](https://supabase.com/docs/guides/api/securing-your-api)

Thông báo Vercel ngày 09/09/2026 cho biết Vercel Authentication có thể bảo vệ cả production trên mọi plan với All Deployments. Một số trang hướng dẫn cũ vẫn mô tả Standard Protection để production public. Vì vậy phải kiểm option thực tế và thử cửa sổ ẩn danh, không suy đoán chỉ từ tên plan hoặc toggle Standard. Không yêu cầu mua gói trả phí. [Vercel announcement](https://vercel.com/changelog/protect-production-deployments-for-free-on-every-plan)

Render Web Service vẫn có endpoint mạng public. Bảo vệ Vercel không bảo vệ trực tiếp URL Render hoặc Supabase. Business API hiện đòi JWT/profile/role, nhưng health và Swagger vẫn public, CORS không chặn curl hoặc request máy chủ. Inbound IP rules cho web service hiện yêu cầu Scale/Enterprise, nên không coi đó là tính năng free đã có. Nếu bắt buộc mọi endpoint đều riêng tư ở mức mạng, phương án này chưa đủ; tiếp tục demo Local/trình chiếu thay vì thêm hạ tầng trong nhiệm vụ này. [Render Inbound IP Rules](https://render.com/docs/inbound-ip-rules)

## 5. Các rủi ro được hoãn, không tuyên bố đã hết

- Credential database owner bị lộ hoặc lỗi tại backend có thể ảnh hưởng toàn bộ dữ liệu vì BYPASSRLS/ownership. Có thể chấp nhận tạm cho demo kiểm soát theo quyết định người dùng, không dùng kết luận này cho vận hành công khai lâu dài.
- Grants rộng ở user_scan_point_access và default privileges vẫn tồn tại. RLS hiện không có policy giúp từ chối theo hàng cho anon/authenticated, nhưng không bao phủ mọi quyền SQL như TRUNCATE. Tắt Data API giúp thu hẹp đường REST; không tự thu hẹp quyền database hoặc thay thế bảo vệ secret.
- Service Role Key phục vụ Auth Admin có quyền cao. Chỉ giữ server-side và không để khán giả sử dụng ADMIN. Không vô hiệu hóa nghiệp vụ quản lý tài khoản để làm demo trông an toàn hơn.
- Warning Leaked Password Protection Disabled vẫn là kết quả Advisor gần nhất do người dùng cung cấp. Dùng password riêng mạnh và giới hạn account; chưa có bằng chứng cần nâng gói.
- Chưa có kiểm thử Auth/Data API/pooler trên Supabase QA đầy đủ, chưa kiểm domain thật, cold start/free-tier capacity hoặc login sau deploy. Những mục này được giảm thành smoke demo bắt buộc, không yêu cầu xây hạ tầng QA mới.

## 6. Thông số Render và Vercel

| Tham số | Render | Vercel |
| --- | --- | --- |
| Root | `backend` | `.` |
| Framework | Node Web Service, NestJS/Express | Vite |
| Node | NODE_VERSION `24.15.0` | `24.x` |
| Install | Trong Build Command | `npm ci --include=dev` |
| Build | `npm ci --include=dev && npm run build` | `npm run build` |
| Start | `npm run start:prod` | Static hosting |
| Output | `dist/main.js` | `frontend/dist` |
| Health | `/api/health` | Login/deep-link smoke |
| Pre-deploy migration | **Để trống** | Không có |

Render cần `NODE_VERSION`, `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT` do Render cấp, `FRONTEND_URL`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. DATABASE_URL dùng cấu hình Supabase ổn định hiện tại ở secret settings, không ép sang warehouse_app trong bản demo này. Không đưa credential vào Git hoặc report.

Vercel cần `VITE_API_URL`, `VITE_SUPABASE_URL`, một trong `VITE_SUPABASE_PUBLISHABLE_KEY`/`VITE_SUPABASE_ANON_KEY`. Đặt đúng origin HTTPS thật trước build, không dùng URL fixture hoặc khóa backend. Chưa có domain Render/Vercel được cấp trong nhiệm vụ.

## 7. Trình tự rút gọn để người dùng quyết định

1. Duyệt bản demo có kiểm soát và chấp nhận rủi ro owner runtime tạm thời. Không apply các script hardening đang hoãn.
2. Kiểm dữ liệu/account, cấu hình giới hạn Vercel và Data API theo mục 4. Không gửi password/token vào chat. Nếu các điều kiện này chưa làm được, chỉ trình chiếu Local.
3. Sau khi người dùng cho phép commit/push/deploy ở nhiệm vụ sau, dùng source hiện tại và lệnh ở mục 6. Chọn origin frontend ổn định để CORS khớp.
4. Trước chia sẻ: kiểm health 200, API thiếu JWT 401, login ba role, VIEWER/STAFF bị chặn đúng quyền, Swagger/deep links, preflight Authorization và Vercel protection ở cửa sổ ẩn danh. Không test ghi kho thật bằng tài khoản khán giả. Thao tác nhập/xuất demo chỉ do người trình diễn thực hiện có chủ đích.
5. Giữ mốc deployment/secret references để quay lại phiên bản trước nếu lỗi, không reset database. Dừng Render khi kết thúc khung demo theo lựa chọn người dùng.

**Kết luận**. Source và build đã sẵn sàng cho bước triển khai demo rút gọn để người dùng phê duyệt. Chưa bật các giới hạn trên cloud hoặc xác minh smoke tại domain thật vì chưa deploy. Không cho phép hiểu kết quả này là PASS public-production. Không tự commit, push hoặc deploy.

Trạng thái security gate mới nhất nằm tại [DEMO_SECURITY_GATE.md](DEMO_SECURITY_GATE.md). Danh sách 45 file ở [DEMO_COMMIT_FILES.txt](DEMO_COMMIT_FILES.txt) thay thế danh sách cũ, không chọn toàn bộ tệp untracked. Kết quả mật khẩu thực tế 13/14 PASS, một tiêu chí chưa xác minh thủ công. Chỉ commit/push nhánh deploy; giữ main/tag, dừng trước deploy.
