# Smart Warehouse Frontend

Hướng dẫn clone, cấu hình Supabase và chạy đồng thời backend/frontend nằm trong [README của repository](../README.md).

Nhận file `.env` đã cấu hình từ admin và đặt vào chính thư mục `frontend/` (cạnh `package.json`), rồi chạy:

```powershell
npm install
npm run dev
```

Trước khi đăng nhập, gửi email muốn dùng cho admin để admin tạo tài khoản Supabase Auth và liên kết với `public.users`. Mở http://127.0.0.1:5173/login bằng thông tin admin cung cấp. Frontend cần backend ở `http://localhost:3000/api`.

Kiểm tra bằng `npm run typecheck`, `npm test`, `npm run build`.
