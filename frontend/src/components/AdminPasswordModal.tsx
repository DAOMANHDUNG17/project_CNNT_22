import { Alert, Button, Checkbox, Descriptions, Form, Input, Modal } from 'antd';
import { useMutation } from '../hooks/useResource';
import { newPasswordRules, resetAccountPassword } from '../lib/account-api';
import type { PasswordInput } from '../lib/account-api';
import type { ManagedUser } from '../lib/users-api';

export function AdminPasswordModal({ target, onClose }: { target: ManagedUser; onClose: () => void }) {
  const [form] = Form.useForm<PasswordInput & { acknowledged: boolean }>();
  const mutation = useMutation();
  const close = () => { if (!mutation.busy) { form.resetFields(); onClose(); } };
  return <Modal title="Đặt lại mật khẩu" open footer={null} closable={!mutation.busy} maskClosable={!mutation.busy} onCancel={close}>
    <Descriptions column={1} items={[{ key: 'name', label: 'Tên tài khoản', children: target.username }, { key: 'email', label: 'Email', children: target.email ?? 'Chưa có email' }]} />
    <Alert className="form-alert" type="warning" showIcon title="Bạn đang thay đổi thông tin đăng nhập của người dùng khác."
      description="Chỉ thực hiện khi được yêu cầu. Gửi mật khẩu mới qua kênh riêng. Không bảo đảm các JWT cũ hết hiệu lực ngay." />
    <Form name="admin-password" form={form} layout="vertical" requiredMark={false} disabled={mutation.busy} onFinish={values => {
      void mutation.run(() => resetAccountPassword(target.user_id, { new_password: values.new_password, confirm_password: values.confirm_password }),
        'Đã đặt lại mật khẩu. Hãy thông báo riêng cho người dùng.', () => { form.resetFields(); onClose(); });
    }}>
      <Form.Item label="Mật khẩu mới" name="new_password" rules={newPasswordRules}><Input.Password autoComplete="new-password" maxLength={128} /></Form.Item>
      <Form.Item label="Xác nhận mật khẩu mới" name="confirm_password" dependencies={['new_password']} rules={[{ required: true, message: 'Xác nhận mật khẩu mới.' }, ({ getFieldValue }) => ({
        validator: (_, value) => !value || value === getFieldValue('new_password') ? Promise.resolve() : Promise.reject(new Error('Xác nhận mật khẩu mới không khớp.')),
      })]}><Input.Password autoComplete="new-password" maxLength={128} /></Form.Item>
      <Form.Item name="acknowledged" valuePropName="checked" rules={[{ validator: (_, value) => value === true ? Promise.resolve() : Promise.reject(new Error('Vui lòng xác nhận thao tác đặt lại mật khẩu.')) }]}>
        <Checkbox>Tôi xác nhận đặt lại mật khẩu cho tài khoản này.</Checkbox></Form.Item>
      <div className="modal-actions"><Button onClick={close} disabled={mutation.busy}>Hủy</Button><Button type="primary" htmlType="submit" loading={mutation.busy}>Xác nhận</Button></div>
    </Form>
  </Modal>;
}
