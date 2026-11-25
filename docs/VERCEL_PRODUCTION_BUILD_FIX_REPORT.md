# D4.1 — Vercel production TypeScript build fix

Ngày 26/11/2026, nhánh deploy/cloud-readiness. Commit lỗi do người dùng cung cấp và đã đối chiếu Local/Remote: a097bd7771fd45c76165c0acff44426a7de2599f.

## Nguyên nhân và bằng chứng

Test production-config.test.ts import trực tiếp vercel.json và để TypeScript suy luận kiểu theo nội dung JSON. Local/commit có ba rewrite nên kiểu có rewrites; log Vercel lại cho thấy kiểu JSON là {}. Khi đó truy cập rewrites sinh TS2339, callback destructuring source mất kiểu ngữ cảnh và sinh TS7031. tsconfig có strict, resolveJsonModule và include tests nên lỗi trong test vẫn chặn production typecheck/build.

Đã kiểm tra đúng source tại a097bd7, phiên bản Local và lockfile cùng TypeScript 5.9.3, Vite 7.3.7, Vitest 5.1.0. Bản archive sạch của commit cũ, cài lại dependencies và giữ JSON đầy đủ, vẫn build PASS. Vì thế chưa có căn cứ nói đơn thuần clean install, Linux, cache hoặc dependency khác phiên bản gây lỗi.

Trong bản tạm, đổi duy nhất vercel.json thành {} đã tái hiện đúng cả hai lỗi tại (122,19)/(122,36), typecheck exit 2; sau đó khôi phục JSON nguyên bản. Chưa có snapshot file/config đầy đủ của worker Vercel ở thời điểm tsc nên chưa khẳng định cơ chế nào đã khiến JSON mang kiểu {} trên nền tảng. Bản sửa loại bỏ sự phụ thuộc kiểu tĩnh vào JSON import; không tuyên bố đã xác minh Vercel tự sửa file.

## Thay đổi

1. frontend/tests/unit/production-config.test.ts: khai báo VercelRewrite và VercelRoutingConfig; đọc file JSON thật tại runtime của test bằng readFileSync/new URL; nhận dữ liệu dưới kiểu unknown, kiểm tra rewrites là array và từng source/destination là string trước khi sử dụng. Callback source và kết quả tìm rewrite có kiểu rõ ràng. Giữ toàn bộ test cũ, thêm chín ca từ chối cấu trúc sai. Không any, ts-ignore, ts-nocheck, type assertion mù hoặc bỏ typecheck.
2. frontend/tests/unit/multi-host.test.ts: lấy cổng trống cụ thể thay vì port 0 bị Vite fallback về 5173. Giữ kiểm tra ba interface, JWT proxy, HMR và giải phóng cổng; không dừng frontend Local của người dùng.
3. frontend/tests/unit/multi-host.test.ts và lan-vite.test.ts: tạo file probe .env.test-* tổng hợp riêng bằng flag wx, kiểm HTTP 403 rồi xóa đúng probe. Không tạo/ghi/đọc .env thật. Như vậy kiểm thử deny-file chạy được trên clone sạch và vẫn kiểm một file thực sự tồn tại, không dựa vào SPA fallback của file thiếu. Test cấu hình vẫn kiểm cả quy tắc .env và .env.*.
4. package.json và frontend/package.json: engines.node từ >=24.7 sang 24.x, ngăn chọn major mới ngoài nhánh 24. README giữ yêu cầu Local tối thiểu 24.7 trong nhánh 24; Vercel chọn Node 24.x.
5. package-lock.json và frontend/package-lock.json: chỉ đổi metadata engines tương ứng; đã đối chiếu cấu trúc, không đổi dependency, version package, resolved hoặc integrity.

Danh sách commit chính xác gồm chín file: README.md; package.json; package-lock.json; frontend/package.json; frontend/package-lock.json; frontend/tests/unit/production-config.test.ts; frontend/tests/unit/multi-host.test.ts; frontend/tests/unit/lan-vite.test.ts; docs/VERCEL_PRODUCTION_BUILD_FIX_REPORT.md. Manifest DEMO_COMMIT_FILES.txt là snapshot của commit chuẩn bị cloud trước đó, không dùng để stage toàn bộ lần sửa D4.1 này.

vercel.json và tsconfig.json đã được rà soát, giữ nguyên. Không loại tests khỏi include hoặc giảm strict/typecheck. Không sửa backend, frontend/src, cấu hình nghiệp vụ, chức năng mật khẩu, Supabase hoặc Data API.

## Môi trường clean và kết quả

Workspace tạm ngoài project: C:\Users\Admin\AppData\Local\Temp\smart-warehouse-d41-9GHzub. Thư mục baseline lấy bằng git archive đúng a097bd7; candidate lấy cùng archive và chồng đúng các file chuẩn bị commit. Không copy node_modules, dist, cache hoặc .env thật từ Local.

| Kiểm tra | Kết quả |
| --- | --- |
| Baseline npm ci --include=dev | Exit 0, 175 packages; audit 0 vulnerabilities |
| Baseline production build với JSON nguyên bản | Exit 0; giải thích vì sao Local trước đó PASS |
| Baseline với JSON {} trong bản tạm | Exit 2; đúng TS2339 và TS7031 như log Vercel; JSON được khôi phục |
| Candidate npm ci --include=dev, NODE_ENV=production | Exit 0; audit 0 vulnerabilities; không đổi lockfile |
| Candidate npm run build | Exit 0; typecheck toàn bộ frontend/tests không có lỗi TypeScript khác |
| Candidate frontend/dist/index.html | Có, 709 bytes |
| Frontend unit tests | 18 files, 107 PASS, 0 FAIL, exit 0; NODE_ENV=test, CI=1, maxWorkers=1 |
| Production config/rewrite focused tests | 31 PASS, 0 FAIL, exit 0 |
| Negative check trên candidate JSON {} | Typecheck exit 0 vì interface độc lập suy luận JSON; test vẫn từ chối cấu trúc sai, expected exit 1 |
| Khôi phục JSON thật sau negative check | Focused 31/31 PASS; JSON/routing gốc không đổi |
| Cấu trúc artifact | Có index, assets, Swagger redirect; không deploy artifact fixture |

Production build dùng NODE_ENV=production, CI=1, VERCEL=1; VITE_API_URL là origin Render người dùng cung cấp, Supabase URL/key là fixture công khai tổng hợp. Không tải credential production vào bản tạm. Unit tests dùng NODE_ENV=test và API fixture có /api, đúng contract test; các HTTP server là doubles trên loopback.

Lượt thử đầu đặt nhầm môi trường unit test thành production, API fixture thiếu /api và không có file deny probe; thêm xung đột port 5173 đã khiến chín ca fail. Đã sửa đúng setup môi trường/fixture và cổng test, giữ các assertion nghiệp vụ. Kết quả cuối 107/107 PASS được chạy trên candidate không có .env thật, không cần file fixture bên ngoài test, không đóng dịch vụ người dùng.

Máy kiểm tra là Windows, Node v24.15.0, npm 11.12.1. Đây là mô phỏng cài mới và lệnh Vercel từ source sạch, không phải chứng nhận worker Linux nội bộ hoặc deployment Vercel thực tế đã PASS. Cảnh báo chunk >500 kB còn tồn tại nhưng không chặn build; không mở rộng sang tối ưu bundle.

## Kiểm tra an toàn và Git

Trước commit, đối chiếu staged names/nội dung với đúng chín file; git diff --check và staged --check; so source build trong candidate với source chuẩn bị commit; quét Git diff, nội dung staged và candidate/frontend/dist theo secret hiện có trong bộ nhớ cùng mẫu private key/privileged JWT. Không in giá trị secret, không stage build output, .env, probe, archive, log hoặc script diagnostic.

So checksum backend, frontend/src, frontend/config, vite.config.ts, tsconfig.json, vercel.json và ba .env thật với trạng thái đầu nhiệm vụ. Giữ main tại 992845e8d72600041ff63eb819f1a7d32316e133 và object tag v1.0.0-pre-deploy tại 009172eadfcb8ac0601281acd4e2de3088fd45b2. Chỉ commit/push nhánh deploy/cloud-readiness; không force, không merge, không push tag, không gọi API quản trị Render/Supabase hoặc thực hiện deploy thủ công.

Message: fix: resolve Vercel production TypeScript build errors.

## Thiết lập Vercel giữ nguyên

- Root Directory: .; Production Branch: deploy/cloud-readiness.
- Node.js Version: 24.x, khớp engines mới. Nếu Dashboard đang chọn major khác, cần đặt lại thành 24.x; không khẳng định cảnh báo cloud đã biến mất khi chưa xem build mới.
- Install: npm ci --include=dev; Build: npm run build; Output Directory: frontend/dist.
- Các biến VITE_API_URL, VITE_SUPABASE_URL và public publishable/anon key được cấu hình trong Vercel, không commit giá trị thật. Không đưa service-role key lên frontend.
- Bảo toàn rewrite /settings và các deep link; giữ API/assets/file requests ngoài SPA fallback.

Tham chiếu: [TypeScript resolveJsonModule](https://www.typescriptlang.org/tsconfig/resolveJsonModule.html), [Vercel Node versions/engines precedence](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

**D4.1 source fix và clean verification: PASS. Kết quả deployment Vercel mới chỉ xác định sau khi nền tảng build commit mới; dừng nhiệm vụ sau push và đối chiếu hash Local/Remote.**
