import { useCallback, useState } from 'react';
import { Alert, App, Avatar, Button, Card, Checkbox, Form, Input, Modal, Popconfirm, Select, Space, Tag } from 'antd';
import { PlusOutlined, SearchOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { createDatabaseUser, listDatabaseUsers, updateDatabaseUser } from '../lib/users-api';
import type { CreateManagedUser, ManagedRole, ManagedUser, PatchManagedUser } from '../lib/users-api';
import { useAuth } from '../auth/AuthProvider';
import { useDebounced, useMutation, useResource } from '../hooks/useResource';
import { errorMessage, passwordRules, roleLabels, textRules, timestamp } from '../lib/format';
import { ActiveTag, DataTable, ErrorNotice, PageHeading, RefreshButton } from '../components/Common';
import { initialScanPointAccess, UserScanPointAccess } from '../components/UserScanPointAccess';
import { replaceUserScanPointAccess, sameScanPointIds } from '../lib/scan-point-access-api';
import { ApiError } from '../lib/api-types';
import { useAssignedScanPoints } from '../hooks/useAssignedScanPoints';

const roleOptions = (['ADMIN', 'STAFF', 'VIEWER'] as const).map(value => ({ value, label: roleLabels[value] }));

export default function UsersPage() {
  const { user: principal, refresh } = useAuth();
  const assignment = useAssignedScanPoints();
  const { message } = App.useApp();
  const [paging, setPaging] = useState({ page: 1, limit: 20 });
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [role, setRole] = useState<ManagedRole>();
  const [active, setActive] = useState<boolean>();
  const [editing, setEditing] = useState<ManagedUser | null>();
  const [editVersion, setEditVersion] = useState(0);
  const [scanAccess, setScanAccess] = useState(initialScanPointAccess);
  const [form] = Form.useForm<CreateManagedUser>();
  const draftRole = Form.useWatch('role', form);
  const mutation = useMutation();
  const resource = useResource(useCallback(signal => listDatabaseUsers({ ...paging, q, role, isActive: active }, { signal }), [paging, q, role, active]));
  const resetPage = () => setPaging(current => ({ ...current, page: 1 }));
  function edit(user: ManagedUser | null) {
    setScanAccess(initialScanPointAccess); setEditVersion(value => value + 1);
    form.resetFields();
    form.setFieldsValue(user ? { ...user, email: user.email ?? '' } : { role: 'STAFF', is_active: true });
    setEditing(user);
  }
  async function afterSelf(id: string) {
    resource.reload();
    if (id === String(principal?.user_id)) { assignment.reload(); await refresh(); }
  }
  async function save(values: CreateManagedUser) {
    if (editing) {
      if (!scanAccess.ready || scanAccess.invalid) return;
      const patch: PatchManagedUser = {};
      if (values.username.trim() !== editing.username) patch.username = values.username.trim();
      if (values.display_name.trim() !== editing.display_name) patch.display_name = values.display_name.trim();
      if (values.role !== editing.role) patch.role = values.role;
      const accessChanged = !sameScanPointIds(scanAccess.ids, scanAccess.savedIds);
      if (!Object.keys(patch).length && !accessChanged) { message.info('Không có thay đổi.'); setEditing(undefined); return; }
      await mutation.run(async () => {
        if (editing.role === 'STAFF' && values.role !== 'STAFF' && scanAccess.ids.length > 1) {
          await updateDatabaseUser(editing.user_id, patch);
          try { await replaceUserScanPointAccess(editing.user_id, scanAccess.ids); }
          catch (error) { resource.reload(); throw new ApiError(error instanceof ApiError ? error.status : 503, 'USER_MANAGEMENT_ERROR', `Thông tin người dùng đã lưu; chưa xác nhận được quyền điểm quét. ${errorMessage(error)}`); }
          return;
        }
        // Save grants before a self-demotion can remove ADMIN privileges.
        if (accessChanged) await replaceUserScanPointAccess(editing.user_id, scanAccess.ids);
        if (Object.keys(patch).length) {
          try { await updateDatabaseUser(editing.user_id, patch); }
          catch (error) {
            if (accessChanged) throw new ApiError(error instanceof ApiError ? error.status : 503, 'USER_MANAGEMENT_ERROR', `Quyền điểm quét đã lưu; thông tin người dùng chưa lưu. ${errorMessage(error)}`);
            throw error;
          }
        }
      }, 'Đã cập nhật người dùng.', async () => {
        form.resetFields(); setEditing(undefined); await afterSelf(editing.user_id);
      });
    } else {
      await mutation.run(() => createDatabaseUser({ username: values.username.trim(), display_name: values.display_name.trim(), email: values.email.trim().toLowerCase(),
        role: values.role, password: values.password, is_active: values.is_active ?? true }), 'Đã tạo người dùng.', () => {
        form.resetFields(); setEditing(undefined); resetPage(); resource.reload();
      });
    }
  }
  const close = () => { if (!mutation.busy) { form.resetFields(); setEditing(undefined); } };
  return <div className="page-enter">
    <PageHeading title="Quản lý người dùng" action={<Space wrap><RefreshButton onClick={resource.reload} loading={resource.loading} />
      <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={() => edit(null)} disabled={mutation.busy}>Thêm người dùng</Button></Space>} />
    <Alert className="role-banner" type="info" showIcon icon={<SafetyCertificateOutlined />} title="Quyền quản trị tài khoản"
      description="Quyền và trạng thái được kiểm tra ở mỗi yêu cầu. Hệ thống luôn giữ ít nhất một ADMIN hoạt động. Tài khoản mới đăng nhập bằng email." />
    <Card className="content-card"><div className="table-toolbar">
      <Input aria-label="Tìm người dùng" prefix={<SearchOutlined />} placeholder="Tìm tài khoản, tên hoặc email…" maxLength={150} allowClear value={search} onChange={event => { setSearch(event.target.value); resetPage(); }} />
      <Space wrap><Select aria-label="Lọc vai trò" placeholder="Mọi vai trò" style={{ minWidth: 170 }} allowClear value={role} options={roleOptions} onChange={value => { setRole(value); resetPage(); }} />
        <Select aria-label="Lọc trạng thái" placeholder="Mọi trạng thái" style={{ minWidth: 170 }} allowClear value={active} options={[{ value: true, label: 'Đang hoạt động' }, { value: false, label: 'Đã khóa' }]} onChange={value => { setActive(value); resetPage(); }} /></Space>
    </div><ErrorNotice error={resource.error} retry={resource.reload} />
      <DataTable<ManagedUser> rowKey="user_id" page={resource.data} loading={resource.loading} onPage={(page, limit) => setPaging({ page, limit })} columns={[
        { title: 'Người dùng', dataIndex: 'display_name', render: (value: string, row) => <Space><Avatar className="user-avatar">{value.slice(0, 1)}</Avatar><div className="cell-product"><strong>{value}{row.user_id === String(principal?.user_id) && <Tag className="self-tag">Bạn</Tag>}</strong><small>{row.username}</small></div></Space> },
        { title: 'Email đăng nhập', dataIndex: 'email', render: (value: string | null) => value ?? 'Chưa có email' },
        { title: 'Vai trò', dataIndex: 'role', render: (value: ManagedRole) => <Tag color={value === 'ADMIN' ? 'geekblue' : value === 'STAFF' ? 'cyan' : 'default'}>{roleLabels[value]}</Tag> },
        { title: 'Trạng thái', dataIndex: 'is_active', render: (value: boolean) => <ActiveTag active={value} /> },
        { title: 'Ngày tạo (UTC+7)', dataIndex: 'created_at', render: timestamp },
        { title: 'Thao tác', key: 'actions', render: (_, row) => <Space wrap><Button size="small" disabled={mutation.busy} onClick={() => edit(row)}>Sửa người dùng</Button>
          <Popconfirm title={row.is_active ? 'Khóa tài khoản?' : 'Mở khóa tài khoản?'} description="Quyền truy cập sẽ áp dụng từ yêu cầu tiếp theo." onConfirm={() => mutation.run(() => updateDatabaseUser(row.user_id, { is_active: !row.is_active }), 'Đã cập nhật trạng thái.', () => afterSelf(row.user_id))}>
            <Button size="small" danger={row.is_active} disabled={mutation.busy}>{row.is_active ? 'Khóa' : 'Mở khóa'}</Button>
          </Popconfirm></Space> },
      ]} /></Card>
    <Modal title={editing ? 'Sửa người dùng' : 'Thêm người dùng'} open={editing !== undefined} forceRender footer={null} closable={!mutation.busy} maskClosable={!mutation.busy} onCancel={close}>
      <Form name="user-editor" form={form} layout="vertical" requiredMark={false} onFinish={values => { void save(values); }} disabled={mutation.busy}>
        <Form.Item label="Tên đăng nhập" name="username" rules={[...textRules(50), { pattern: /^[A-Za-z0-9_.-]+$/, message: 'Chỉ dùng chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.' }]}><Input maxLength={50} autoComplete="off" /></Form.Item>
        <Form.Item label="Tên hiển thị" name="display_name" rules={textRules(120)}><Input maxLength={120} /></Form.Item>
        <Form.Item label="Email đăng nhập" name="email" rules={editing ? [] : [{ required: true, message: 'Nhập email.' }, { type: 'email', message: 'Email không hợp lệ.' }, { max: 254 }]} extra={editing ? 'Email được liên kết với tài khoản Supabase Auth.' : undefined}><Input type="email" maxLength={254} disabled={!!editing || mutation.busy} autoComplete="off" /></Form.Item>
        <Form.Item label="Vai trò" name="role" rules={[{ required: true, message: 'Chọn vai trò.' }]}><Select options={roleOptions} /></Form.Item>
        {editing && <UserScanPointAccess key={`${editing.user_id}-${editVersion}`} userId={editing.user_id} role={draftRole ?? editing.role} disabled={mutation.busy} onChange={setScanAccess} />}
        {!editing && <><Form.Item label="Mật khẩu ban đầu" name="password" rules={passwordRules} extra="12–128 ký tự. Chuyển mật khẩu cho người dùng qua kênh riêng."><Input.Password autoComplete="new-password" maxLength={128} /></Form.Item>
          <Form.Item name="is_active" valuePropName="checked"><Checkbox>Cho phép hoạt động ngay</Checkbox></Form.Item></>}
        <div className="modal-actions"><Button disabled={mutation.busy} onClick={close}>Hủy</Button><Button aria-label="Lưu người dùng" type="primary" htmlType="submit" loading={mutation.busy} disabled={!!editing && (!scanAccess.ready || scanAccess.invalid)}>Lưu người dùng</Button></div>
      </Form>
    </Modal>
  </div>;
}
