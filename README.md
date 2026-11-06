# Smart Stationery Warehouse — Đề tài 22

Repository hiện chứa frontend React + TypeScript + Vite + Ant Design chạy độc lập trong development bằng Mock Mode. Backend và database cũ đã được loại bỏ; `backend/` và `database/` là vị trí trống dành cho giai đoạn thiết kế mới.

## Chạy frontend

```powershell
npm.cmd install
npm.cmd run dev
```

Mở `http://127.0.0.1:5173`. Trong development, đăng nhập bằng tên và mật khẩu bất kỳ không rỗng. Mock authentication không hoạt động như cơ chế bảo mật production.

## Kiểm tra

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
npm.cmd run test:e2e
```

Ba file `docs/openapi.json`, `docs/api-client.ts` và `docs/AN_FRONTEND_HANDOFF.md` là tài liệu tham khảo legacy, không phải contract bắt buộc cho backend mới.
