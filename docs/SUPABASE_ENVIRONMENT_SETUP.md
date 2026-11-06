# Cấu hình Supabase Cloud — đối chiếu code hiện tại

Ngày 05/11/2026. **Chỉ chuẩn bị cấu hình, không kết nối.** Cloud dùng PostgreSQL + Supabase Authentication; không Redis/Docker trong Cloud profile. Local-test vẫn giữ nguyên.

## File thực tế và những gì đã điền

File đã tạo là **`D:\Project_CNNT\.env.cloud`**. Đường dẫn `D:\Project_CNNT.env.cloud` (không dấu `\` trước `.env.cloud`) không tồn tại lúc kiểm tra. File `.env` local không bị sửa.

Đã điền từ thông tin chủ dự án: ref/expected-ref `offprveszircoaxyaxpf`, URL `https://offprveszircoaxyaxpf.supabase.co`, direct host `db.offprveszircoaxyaxpf.supabase.co`, port5432, database postgres. Giữ cấu hình loopback/origin và hai runtime role theo kiến trúc. **Không xác nhận các role đã tồn tại**, không thử mật khẩu, không tự lấy keys.

Đã kiểm bằng CLI offline: còn thiếu publishable key, JWT verification mode/algorithm, hai file mật khẩu role, file HMAC key và CA. `.env.cloud` cùng `.cloud-private/` được Git ignore. Ignore không thay thế bảo vệ quyền đọc file.

## Biến bắt buộc

| Biến | Giá trị/ý nghĩa đúng theo code | Phân loại |
| --- | --- | --- |
| `APP_ENV_FILE` | Biến **shell**, đường dẫn tuyệt đối file env được chọn; không fallback `.env` chính | Đường dẫn cấu hình, không secret |
| `APP_PROFILE` | `supabase-cloud`, phải khai báo ngay trong file | Không secret |
| `SUPABASE_PROJECT_REF` | `offprveszircoaxyaxpf` | Công khai |
| `SUPABASE_EXPECTED_PROJECT_REF` | Cùng ref đã duyệt; khác ref bị từ chối | Công khai |
| `SUPABASE_URL` | `https://offprveszircoaxyaxpf.supabase.co` đúng không dấu `/` cuối | Công khai |
| `SUPABASE_PUBLISHABLE_KEY` | Key thật dạng `sb_publishable_...` từ đúng project; thay placeholder | Công khai, được phép trong browser; không phải service secret |
| `SUPABASE_JWT_VERIFICATION` | `jwks` cho ES256/RS256; `auth-server` cho HS256 | Không secret, phải xác minh cấu hình thực |
| `SUPABASE_JWT_ALGORITHM` | Chính xác `ES256`, `RS256` hoặc `HS256` tương ứng mode | Không secret; **đang để trống vì chưa biết** |
| `SUPABASE_DB_MODE` | `direct` hiện tại; chỉ dùng `session` khi có đúng endpoint pooler | Không secret |
| `PGHOST` | Direct host đã điền ở trên; session mode dùng host Dashboard cung cấp | Không secret |
| `PGDATABASE` | `postgres` | Không secret |
| `PGUSER` | `warehouse_readonly` | Tên role nội bộ, không secret |
| `WRITE_PGUSER` | `warehouse_backend` | Tên role nội bộ, không secret |
| `ALLOWED_ORIGINS` | `http://127.0.0.1:5173`; nhiều origin phân cách dấu phẩy, không dấu cách/wildcard/path | Không secret |
| `PGSSLROOTCERT` | Đường dẫn CA PEM tin cậy; template `./.cloud-private/provider-ca.pem` | CA là chứng chỉ công khai, **không phải private key** |
| `PGPASSWORD_FILE` hoặc `PGPASSWORD` | Mật khẩu của **warehouse_readonly**; ưu tiên file | **Secret** |
| `WRITE_PGPASSWORD_FILE` hoặc `WRITE_PGPASSWORD` | Mật khẩu của **warehouse_backend**; ưu tiên file | **Secret** |
| `CLOUD_RATE_HMAC_KEY_FILE` hoặc `CLOUD_RATE_HMAC_KEY` | Khóa ngẫu nhiên riêng của ứng dụng, >=32byte; dùng chung bốn backend Cloud | **Secret**, không phải Supabase JWT secret |

Code ưu tiên `_FILE` nếu có. Chọn một cách lưu cho mỗi secret; không để file placeholder trong khi điền biến inline vì file vẫn được ưu tiên. Env file được chọn là nguồn Cloud duy nhất: biến PG/SUPABASE/CLOUD còn sót trong shell không được dùng bù. Các đường dẫn `_FILE` và CA tương đối được resolve theo thư mục chứa env file, **không** theo thư mục terminal. `~`, `%USERPROFILE%` và `${...}` trong env file không được tự expand; dùng đường dẫn thật. Trên Windows có thể dùng dấu `/`, ví dụ `C:/Users/Admin/warehouse-private/reader-password.txt`.

Không cần `SUPABASE_SECRET_KEY`, service_role key, JWT signing secret/private key, DATABASE_URL hoặc bất kỳ REDIS_* cho luồng hiện tại. Không dùng password tài khoản đăng nhập Dashboard hay password postgres admin thay cho password hai runtime roles. Nếu mới chỉ có postgres admin/database data, cần chốt provisioning role sau này; **không tự đổi PGUSER thành postgres**.

## Biến có mặc định / giới hạn

| Biến | Mặc định / kiểm tra |
| --- | --- |
| `HOST` | `127.0.0.1`; chỉ localhost/127.0.0.1/::1 |
| `PORT` | `3000`; frontend proxy hiện cố định3000, giữ giá trị này |
| `NODE_ENV` | Template development; production không cho Origin HTTP |
| `PGPORT` | `5432`; chỉ chấp nhận5432, không transaction pooler6543 |
| `PGSCHEMA` | `public`; không chấp nhận schema khác cho business tables |
| `PGSSLMODE` | Nên giữ `verify-full`; nếu khai báo giá trị khác bị từ chối; `pg` luôn CA+hostname verification |
| `PGPOOL_MAX` | `3` mỗi pool, tối đa5; hai pools/bốn máy cần tính quota |
| `PGCONNECT_TIMEOUT_MS` | `5000`, tối đa30000 |
| `PGQUERY_TIMEOUT_MS` | `5000`, tối đa30000; client query deadline cộng1000ms |

`NODE_TLS_REJECT_UNAUTHORIZED=0` bị từ chối, không dùng để chữa lỗi certificate.

## Lấy key, signing mode và CA

Trong Supabase project Dashboard, mở **Connect** hoặc **Settings → API Keys**, lấy **publishable key** của đúng project và điền vào `SUPABASE_PUBLISHABLE_KEY`. Module hiện chỉ hỗ trợ định dạng mới này, không nhận legacy anon JWT hay `sb_secret_...`. Không cần bật Data API để frontend gọi Auth. [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

Xem phần **JWT Signing Keys** của project, xác định thuật toán active. Nếu ES256/RS256 thì `jwks`; nếu HS256 thì `auth-server`, Backend gọi official Auth SDK để kiểm token. Không copy signing secret vào env, không rotate key để khớp mẫu. Thuật toán khác như EdDSA chưa được code hiện tại hỗ trợ: báo lại để review, không đoán. [Signing keys](https://supabase.com/docs/guides/auth/signing-keys).

Tải **server root certificate** từ **Database settings → SSL Configuration → Download Certificate** và lưu PEM đúng `PGSSLROOTCERT`. Đây phải là CA cho endpoint thực tế, không phải certificate tự tạo hoặc một đoạn BEGIN/END giả. Module chỉ kiểm hình thức PEM offline; tính tin cậy/hostname chỉ kiểm khi được phép handshake TLS. Nếu chuyển pooler, cần xác nhận chain cho endpoint pooler, không tắt xác minh. [Supabase SSL guidance](https://supabase.com/docs/guides/database/connecting-to-postgres#ssl).

## Lưu secret và certificate trên máy

Mẫu hiện trỏ tới:

```text
D:\Project_CNNT\.cloud-private\reader-password.txt   SECRET
D:\Project_CNNT\.cloud-private\writer-password.txt   SECRET
D:\Project_CNNT\.cloud-private\rate-hmac.txt         SECRET
D:\Project_CNNT\.cloud-private\provider-ca.pem       PUBLIC CERTIFICATE
```

Chưa tạo các file hoặc mật khẩu này. Có thể lưu ngoài repo trong thư mục riêng và sửa đường dẫn tuyệt đối trong env; đây là lựa chọn tốt hơn khi chia sẻ workspace. Giới hạn Windows folder/file ACL cho tài khoản chạy backend và các tài khoản quản trị máy cần thiết; không cấp Everyone/Users quyền đọc secret. Không gửi file vào Git, chat, ảnh chụp, logs hoặc thư mục đồng bộ công khai. Chia sẻ giữa đồng đội qua password manager/kênh mã hóa; DB role credential và HMAC đều là secret, publishable key/CA không phải.

Secret file phải chỉ chứa giá trị, UTF-8 **không BOM, không CR/LF cuối**, không dấu nháy bao quanh. PowerShell `Set-Content` mặc định có thể thêm newline; dùng editor lưu chính xác hoặc `WriteAllText(..., new UTF8Encoding(false))`. File CA được phép nhiều dòng, chứa public CERTIFICATE blocks; không chứa PRIVATE KEY. Mật khẩu role phải do người quản trị đã cấp, không đoán hoặc sinh mật khẩu mới rồi giả định Cloud sẽ chấp nhận.

HMAC key khác: đây là secret mới do ứng dụng quản lý. Khi chủ dự án sẵn sàng, tự sinh bằng CSPRNG tối thiểu32byte, lưu base64url/hex vào file không in ra terminal, phân phối cùng giá trị cho các backend. Đợt này chưa tự tạo HMAC key. Không dùng project ref, publishable key hoặc một câu dễ nhớ làm HMAC key.

Frontend chỉ được launcher chuyển ba giá trị: `VITE_APP_PROFILE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Không prefix VITE_ cho password, service key hoặc HMAC; không truyền cả backend env cho frontend. Session access/refresh tokens cũng là secret, không lấy để điền vào file cấu hình.

## Kiểm tra offline sau khi điền

```powershell
cd D:\Project_CNNT
$env:APP_ENV_FILE = 'D:\Project_CNNT\.env.cloud'
npm.cmd run check:cloud-config
```

Lệnh chỉ đọc/validate file, không import driver/Auth SDK, không gọi mạng. Nó chỉ báo tên biến/file thiếu, không in secret. Hiện tại kết quả đúng là **incomplete**, exit1. Kết quả PASS sau khi điền cũng **không** chứng minh password đúng, CA đúng server, database đã có schema hoặc đăng nhập Cloud hoạt động.

Chưa chạy `check:cloud`, `start:cloud`, `dev:cloud`, migration hoặc E2E. `check:cloud` là lệnh kết nối thật (dù chỉ READ ONLY), cần phê duyệt mới. Hai lệnh start/dev còn release gate do password lifecycle/staging chưa nghiệm thu. Việc chủ dự án đã tạo dữ liệu không tự chứng minh roles/ACL/functions/mapping khớp; sẽ đối chiếu khi được phép preflight.
