import { useState } from 'react';
import { Alert, Button, Form, Input } from 'antd';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../lib/format';
import { ApiError } from '../lib/api';
import { LoadingScreen } from '../components/Common';
import { WarehouseIllustration } from '../components/WarehouseIllustration';
const isCloud=false;

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
    <div className="login-identity"><WarehouseIllustration /><div className="login-wordmark">smart<strong>warehouse</strong></div></div>
  </section><section className="login-form-side"><div className="login-form-wrap"><h2>SmartWarehouse</h2><p className="login-form-subtitle">Tiếp tục với tài khoản được cung cấp</p>
    {!!error && <Alert type="error" showIcon title={errorMessage(error)} className="login-alert" />}
    {!error && !!auth.error && <Alert type="warning" showIcon title={errorMessage(auth.error)} className="login-alert" />}
    <Form name="warehouse-login" form={form} layout="vertical" requiredMark={false} onFinish={values => { void submit(values); }} autoComplete="on" size="large">
      <Form.Item label={isCloud ? 'Email' : 'Tên đăng nhập'} name="username" rules={isCloud ? [{ required: true, type: 'email', message: 'Nhập email được cấp.' }] : [{ required: true, whitespace: true, message: 'Nhập tên đăng nhập.' }]}><Input className="login-username" type={isCloud ? 'email' : 'text'} autoComplete="username" maxLength={isCloud ? 254 : 50} placeholder={isCloud ? 'Nhập email được cấp' : 'Nhập tên đăng nhập'} /></Form.Item>
      <Form.Item label="Mật khẩu" name="password" rules={[{ required: true, message: 'Nhập mật khẩu.' }]}><Input.Password autoComplete="current-password" placeholder="Nhập mật khẩu" maxLength={128} /></Form.Item>
      <Button aria-label="Đăng nhập" block type="primary" htmlType="submit" loading={busy}>Đăng nhập</Button>
    </Form>
  </div></section></div>;
}
