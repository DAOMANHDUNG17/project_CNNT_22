# Smart Warehouse Backend

Hướng dẫn clone, cấu hình Supabase và chạy đồng thời backend/frontend nằm trong [README của repository](../README.md).

Nhận file `.env` đã cấu hình từ admin và đặt vào chính thư mục `backend/` (cạnh `package.json`), rồi chạy:

```powershell
npm install
npm run start:dev
```

API: http://localhost:3000/api · Health: http://localhost:3000/api/health · Swagger: http://localhost:3000/api/docs.

Kiểm tra bằng `npm run build`, `npm test`, `npm run test:e2e`, `npm run lint`. Dừng server bằng `Ctrl+C` trước khi build lại nếu Windows báo lỗi `EPERM` ở `dist/`.
