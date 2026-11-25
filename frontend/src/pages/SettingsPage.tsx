import { useCallback } from 'react';
import { Alert, App, Button, Card, Col, Descriptions, Form, Input, List, Row, Tag } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useAssignedScanPoints } from '../hooks/useAssignedScanPoints';
import { useMutation, useResource } from '../hooks/useResource';
import { accountProfile, changeOwnPassword, newPasswordRules } from '../lib/account-api';
import type { OwnPasswordInput } from '../lib/account-api';
import { roleLabels } from '../lib/format';
import { ErrorNotice, PageHeading, RefreshButton } from '../components/Common';

export default function SettingsPage() {
  const { user, finishPasswordChange } = useAuth();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const assignments = useAssignedScanPoints();
  const profile = useResource(useCallback(signal => accountProfile({ signal }), []));
  const mutation = useMutation();
  const [form] = Form.useForm<OwnPasswordInput>();
  const current = Form.useWatch('current_password', form);
  async function submit(values: OwnPasswordInput) {
    await mutation.run(async () => {
      const result = await changeOwnPassword(values);
      form.resetFields();
      const localConfirmed = await finishPasswordChange();
      if (!result.refresh_sessions_revoked || !localConfirmed) {
        message.warning('Mật khẩu đã đổi. Chưa xác nhận thu hồi đầy đủ phiên cũ; hãy đóng các phiên khác và đăng nhập lại.');
      }
      navigate('/login', { replace: true });
    }, 'Đã đổi mật khẩu. Vui lòng đăng nhập lại.');
  }
  return <div className="page-enter">
    <PageHeading title="Cài đặt tài khoản" />
    <Row gutter={[24, 24]}>
      <Col xs={24} lg={12}><Card className="content-card" title="Thông tin tài khoản" loading={profile.loading}
        extra={<RefreshButton onClick={profile.reload} loading={profile.loading} />}>
        <ErrorNotice error={profile.error} retry={profile.reload} />
        <Descriptions column={1} items={[
          { key: 'name', label: 'Họ tên', children: profile.data?.display_name ?? user?.display_name ?? '—' },
          { key: 'username', label: 'Tên đăng nhập', children: profile.data?.username ?? user?.username ?? '—' },
          { key: 'email', label: 'Email', children: profile.data?.email ?? 'Chưa tải được email' },
          { key: 'role', label: 'Vai trò', children: user ? <Tag color="red">{roleLabels[user.role]}</Tag> : '—' },
        ]} />
        <h3>Điểm quét được cấp</h3>
        <ErrorNotice error={assignments.error} retry={assignments.reload} />
        <List loading={assignments.loading} dataSource={assignments.points} locale={{ emptyText: 'Chưa được cấp điểm quét đang hoạt động.' }}
          renderItem={point => <List.Item><List.Item.Meta title={point.scan_point_id} description={point.point_name} /></List.Item>} />
      </Card></Col>
      <Col xs={24} lg={12}><Card className="content-card" title="Thay đổi mật khẩu">
        <Alert className="form-alert" type="info" showIcon title="Sau khi đổi mật khẩu, bạn cần đăng nhập lại."
          description="Mật khẩu mới cần 8–128 ký tự và đáp ứng chính sách Supabase. JWT đã cấp có thể còn hiệu lực đến khi hết hạn." />
        <Form name="account-password" form={form} layout="vertical" requiredMark={false} disabled={mutation.busy} onFinish={values => { void submit(values); }}>
          <Form.Item label="Mật khẩu hiện tại" name="current_password" rules={[{ required: true, message: 'Nhập mật khẩu hiện tại.' }]}>
            <Input.Password autoComplete="current-password" maxLength={1024} /></Form.Item>
          <Form.Item label="Mật khẩu mới" name="new_password" dependencies={['current_password']} rules={[...newPasswordRules, {
            validator: (_, value) => !value || value !== current ? Promise.resolve() : Promise.reject(new Error('Mật khẩu mới phải khác mật khẩu hiện tại.')),
          }]}><Input.Password autoComplete="new-password" maxLength={128} /></Form.Item>
          <Form.Item label="Xác nhận mật khẩu mới" name="confirm_password" dependencies={['new_password']} rules={[{ required: true, message: 'Xác nhận mật khẩu mới.' }, ({ getFieldValue }) => ({
            validator: (_, value) => !value || value === getFieldValue('new_password') ? Promise.resolve() : Promise.reject(new Error('Xác nhận mật khẩu mới không khớp.')),
          })]}><Input.Password autoComplete="new-password" maxLength={128} /></Form.Item>
          <Button type="primary" htmlType="submit" icon={<LockOutlined />} loading={mutation.busy}>Cập nhật mật khẩu</Button>
        </Form>
      </Card></Col>
    </Row>
  </div>;
}
