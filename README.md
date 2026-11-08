# Smart Warehouse

Ứng dụng quản lý kho văn phòng phẩm gồm NestJS (`backend/`), React + Vite (`frontend/`) và PostgreSQL trên Supabase. Frontend đăng nhập bằng Supabase Auth, sau đó gửi JWT đến backend. Các màn Products, Inventory, Scan Points và Product Units đang đọc dữ liệu thật qua backend.

## 1. Chuẩn bị

- Cài Git và Node.js **24.7 trở lên** (kèm npm). Kiểm tra bằng `git --version`, `node --version`, `npm --version`.
- Có quyền truy cập **cùng một Supabase project** với nhóm, một tài khoản Supabase Auth đã được liên kết với `public.users`, và các giá trị cấu hình bên dưới. Nhờ người quản lý project cấp quyền/cấu hình qua kênh riêng; repository không chứa mật khẩu hay key thật.
- PostgreSQL của project phải có sẵn schema và dữ liệu cần dùng. `npm install` chỉ cài package, không tạo database.

Các lệnh dưới đây dành cho PowerShell trên Windows. Trên macOS/Linux, thay `Copy-Item` bằng `cp`. Nếu PowerShell chặn `npm.ps1`, dùng `npm.cmd` thay cho `npm`.

## 2. Clone và cài package

```powershell
git clone https://github.com/DAOMANHDUNG17/project_CNNT_22.git
cd project_CNNT_22

cd backend
npm install
cd ..\frontend
npm install
cd ..
```

Chạy `npm install` **trong từng thư mục**. Các script npm ở thư mục gốc hiện chỉ dành cho frontend; chạy ở gốc sẽ không cài hoặc khởi động backend.

## 3. Cấu hình môi trường

Từ thư mục gốc vừa clone:

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
```

Điền `backend/.env`:

| Biến | Cách điền |
| --- | --- |
| `PORT` | `3000` nếu cổng này còn trống. |
| `FRONTEND_URL` | `http://127.0.0.1:5173` hoặc `http://localhost:5173`. |
| `DATABASE_URL` | PostgreSQL connection string của Supabase. Lấy trong **Connect → Session pooler** (cổng 5432) nếu mạng chỉ hỗ trợ IPv4; thay placeholder mật khẩu bằng mật khẩu database thật. |
| `SUPABASE_URL` | Project URL dạng `https://<project-ref>.supabase.co`, lấy từ Supabase Project Settings. Backend dùng URL này để kiểm tra JWT qua JWKS. |
| `SUPABASE_ANON_KEY` | Chưa cần cho backend hiện tại; có thể để trống. |

Điền `frontend/.env`:

| Biến | Cách điền |
| --- | --- |
| `VITE_SUPABASE_URL` | Cùng Project URL với backend. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key của project trong Supabase API Keys. Nếu project dùng anon key cũ, có thể dùng `VITE_SUPABASE_ANON_KEY` thay thế. |
| `VITE_API_URL` | `http://localhost:3000/api` khi backend chạy cổng mặc định. Nếu đổi `PORT`, sửa cổng ở đây cho khớp. |

Không đưa `DATABASE_URL`, mật khẩu database, `service_role` key hoặc JWT vào frontend. Không commit hai file `.env`; chỉ `.env.example` được theo dõi trong Git. Mọi biến bắt đầu bằng `VITE_` đều có thể xuất hiện trong mã frontend gửi tới trình duyệt, vì vậy chỉ dùng publishable/anon key ở đây.

## 4. Chạy ứng dụng

Mở **hai terminal** và giữ cả hai chạy:

Terminal 1 — backend (đứng ở thư mục gốc repository):

```powershell
cd backend
npm run start:dev
```

Backend mặc định ở `http://localhost:3000/api`. Kiểm tra:

- Health + database: http://localhost:3000/api/health — khi kết nối tốt có `"database":"connected"`.
- Swagger: http://localhost:3000/api/docs.

Terminal 2 — frontend (đứng ở thư mục gốc repository):

```powershell
cd frontend
npm run dev
```

Mở http://127.0.0.1:5173/login và đăng nhập bằng **email/mật khẩu Supabase Auth được cấp**. Tài khoản cũng phải có bản ghi `public.users` đang hoạt động; quyền ADMIN/STAFF/VIEWER được lấy từ bản ghi đó. Sau khi đăng nhập, mở http://127.0.0.1:5173/products để kiểm tra dữ liệu thật.

Nếu vừa sửa `.env`, dừng tiến trình bằng `Ctrl+C` rồi chạy lại server tương ứng. Để chạy backend một lần không theo dõi file, dùng `npm run start`; để chạy bản build, dùng `npm run build` rồi `npm run start:prod` trong `backend/`.

## 5. Kiểm tra khi gặp lỗi

- Backend không khởi động: kiểm tra `backend/.env` đã có `DATABASE_URL` và `SUPABASE_URL` hợp lệ; cổng `3000` chưa bị tiến trình khác chiếm.
- Health trả `database: disconnected`: kiểm tra connection string, mật khẩu, mạng và phương thức **Session pooler** nếu direct connection không hoạt động trên IPv4.
- Frontend báo lỗi cấu hình Supabase: kiểm tra `frontend/.env` có `VITE_SUPABASE_URL` và publishable key (hoặc anon key cũ), sau đó khởi động lại Vite.
- Đăng nhập được ở Supabase nhưng API trả `403`: kiểm tra tài khoản Auth đã được liên kết với một dòng `public.users` có `is_active = true` và role hợp lệ. `401` thường là thiếu JWT hoặc phiên đăng nhập đã hết hạn.
- Thông báo cổng đang dùng hoặc lỗi `EPERM` ở `backend/dist`: dừng các tiến trình Nest cũ bằng `Ctrl+C` trước khi chạy lại/build; không chạy nhiều backend trên cùng cổng.

## 6. Build và test

Trong `backend/`:

```powershell
npm run build
npm test
npm run test:e2e
npm run lint
```

Trong `frontend/`:

```powershell
npm run typecheck
npm test
npm run build
```

Frontend hiện không có script lint riêng. Các test tự động không thay thế bước đăng nhập và kiểm tra giao diện với Supabase project thật.
