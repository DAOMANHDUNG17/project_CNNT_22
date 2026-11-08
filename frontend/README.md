# Smart Warehouse Frontend

Hướng dẫn clone, cấu hình Supabase và chạy đồng thời backend/frontend nằm trong [README của repository](../README.md).

Sau khi tạo `frontend/.env` từ `.env.example` và điền `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, chạy trong thư mục này:

```powershell
npm install
npm run dev
```

Mở http://127.0.0.1:5173/login. Frontend cần backend ở `http://localhost:3000/api` và tài khoản Supabase Auth đã liên kết với `public.users`.

Kiểm tra bằng `npm run typecheck`, `npm test`, `npm run build`.
