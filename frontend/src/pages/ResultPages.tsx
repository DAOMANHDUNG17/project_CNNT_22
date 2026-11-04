import { Button, Result } from 'antd';
import { Link } from 'react-router-dom';
export function ForbiddenPage() { return <Result status="403" title="Bạn chưa có quyền truy cập" subTitle="Tài khoản hiện tại không được phép sử dụng chức năng này. Liên hệ quản trị viên nếu cần hỗ trợ." extra={<Link to="/"><Button type="primary">Về tổng quan</Button></Link>} />; }
export function NotFoundPage() { return <Result status="404" title="Không tìm thấy trang" subTitle="Đường dẫn không tồn tại hoặc đã được thay đổi." extra={<Link to="/"><Button type="primary">Về tổng quan</Button></Link>} />; }
