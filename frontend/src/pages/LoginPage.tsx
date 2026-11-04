import { useState } from 'react';
import { Alert, Button, Form, Input, Tag } from 'antd';
import { ArrowRightOutlined, CheckOutlined, DatabaseOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../lib/format';
import { ApiError } from '../lib/api';
import { LoadingScreen } from '../components/Common';

export function LoginPage() {
  const auth = useAuth(), location = useLocation();
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  const [waitUntil, setWaitUntil] = useState(0);
  const [form] = Form.useForm<{ username: string; password: string }>();
  const from = (location.state as { from?: string } | null)?.from;
  if (!auth.ready) return <LoadingScreen />;
  if (auth.user) return <Navigate replace to={from?.startsWith('/') && !from.startsWith('//') && !from.startsWith('/login') ? from : '/'} />;
  async function submit(values: { username: string; password: string }) {
    if (busy) return;
    if (Date.now() < waitUntil) { setError(new ApiError(429, 'TOO_MANY_REQUESTS', '', Math.ceil((waitUntil-Date.now())/1000))); return; }
    setBusy(true); setError(undefined);
    try { await auth.login(values.username, values.password); form.resetFields(['password']); }
    catch (failure) {
      setError(failure);
      if (failure instanceof ApiError && failure.status === 429) setWaitUntil(Date.now() + (failure.retryAfter ?? 900) * 1000);
    } finally { setBusy(false); form.resetFields(['password']); }
  }
  return <div className="login-page"><section className="login-story">
    <div className="brand login-brand"><span className="brand-icon"><DatabaseOutlined /></span><span>smart<span className="brand-light">warehouse</span><small>STATIONERY MANAGEMENT</small></span></div>
    <div className="login-story-body"><Tag color="rgba(255,255,255,.12)">KHÔNG GIAN LÀM VIỆC THÔNG MINH</Tag><h1>Kho gọn gàng.<br />Công việc<br /><em>nhẹ nhàng hơn.</em></h1><p>Một nơi để quản lý văn phòng phẩm, theo dõi tồn kho và kết nối mọi điểm nhập xuất.</p>
      <div className="login-features"><span><CheckOutlined /> Tồn kho rõ ràng</span><span><CheckOutlined /> Lịch sử minh bạch</span><span><CheckOutlined /> Phân quyền chặt chẽ</span></div>
      <div className="warehouse-illustration" aria-hidden="true"><div className="shelf shelf-top"><i /><i /><i /></div><div className="shelf shelf-bottom"><i /><i /><i /></div><div className="floating-label"><span className="pulse-dot" /> Mọi chuyển động đều được ghi nhận</div></div>
    </div><div className="login-story-footer">SMART STATIONERY WAREHOUSE <span>Đơn giản hóa mỗi ngày làm việc.</span></div>
  </section><section className="login-form-side"><div className="login-form-wrap"><span className="eyebrow">CHÀO MỪNG TRỞ LẠI</span><h2>Đăng nhập vào kho</h2><p className="muted">Tiếp tục công việc với tài khoản của bạn.</p>
    {!!error && <Alert type="error" showIcon title={errorMessage(error)} className="login-alert" />}
    {!error && !!auth.error && <Alert type="warning" showIcon title={errorMessage(auth.error)} className="login-alert" />}
    <Form form={form} layout="vertical" requiredMark={false} onFinish={values => { void submit(values); }} autoComplete="on" size="large">
      <Form.Item label="Tên đăng nhập" name="username" rules={[{ required: true, whitespace: true, message: 'Nhập tên đăng nhập.' }]}><Input prefix={<UserOutlined />} autoComplete="username" maxLength={50} placeholder="Nhập tên đăng nhập" autoFocus /></Form.Item>
      <Form.Item label="Mật khẩu" name="password" rules={[{ required: true, message: 'Nhập mật khẩu.' }]}><Input.Password prefix={<LockOutlined />} autoComplete="current-password" placeholder="Nhập mật khẩu" maxLength={128} /></Form.Item>
      <Button aria-label="Đăng nhập" block type="primary" htmlType="submit" loading={busy} icon={<ArrowRightOutlined aria-hidden />} iconPlacement="end">Đăng nhập</Button>
    </Form><p className="login-help"><LockOutlined /> Phiên đăng nhập được bảo vệ. Liên hệ quản trị viên nếu bạn cần cấp lại quyền truy cập.</p>
  </div><footer>Smart Stationery Warehouse · Quản lý kho văn phòng phẩm</footer></section></div>;
}
