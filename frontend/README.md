# Smart Stationery Warehouse Frontend

React + TypeScript + Vite + Ant Design, chạy độc lập bằng Mock Mode trong development.

```powershell
npm.cmd install
npm.cmd run dev
```

Mở `http://127.0.0.1:5173`, đăng nhập bằng tên và mật khẩu bất kỳ không rỗng. Mock auth chỉ hoạt động khi Vite chạy development; production build không coi mock là cơ chế bảo mật.

Kiểm tra UI ở trạng thái rỗng hoặc lỗi bằng `VITE_MOCK_SCENARIO=empty` hoặc `VITE_MOCK_SCENARIO=error` trước khi chạy dev server.
