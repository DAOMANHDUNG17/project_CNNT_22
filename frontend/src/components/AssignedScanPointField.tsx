import { Alert, Input, Select, Space } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import type { useAssignedScanPoints } from '../hooks/useAssignedScanPoints';
import { ErrorNotice } from './Common';

export function AssignedScanPointField({ assignment, adminPointId, onAdminChange, frozen, label, pendingPointId }: {
  assignment: ReturnType<typeof useAssignedScanPoints>; adminPointId?: string; onAdminChange: (id: string) => void;
  frozen: boolean; label: string; pendingPointId?: string;
}) {
  const pendingAllowed = !pendingPointId || assignment.points.some(point => point.scan_point_id === pendingPointId);
  return <Space direction="vertical" style={{ width: '100%' }}>
    <div><label>{label}</label>{assignment.staff
      ? <Input aria-label="Điểm quét được phân công" prefix={<LockOutlined />} readOnly value={assignment.single ? `${assignment.single.scan_point_id} — ${assignment.single.point_name}` : assignment.loading ? 'Đang tải phân công…' : 'Chưa có phân công hợp lệ'} />
      : <Select aria-label={label} style={{ width: '100%' }} placeholder="Chọn điểm quét đã được cấp quyền" value={adminPointId}
        options={assignment.points.map(point => ({ value: point.scan_point_id, label: `${point.scan_point_id} — ${point.point_name}` }))} onChange={onAdminChange} disabled={frozen || !assignment.ready} />}</div>
    <ErrorNotice error={assignment.error} retry={assignment.reload} />
    {assignment.ready && !assignment.points.length && <Alert type="warning" showIcon title="Chưa được phân công điểm quét hoạt động. Liên hệ ADMIN để được cấp quyền nhập/xuất." />}
    {assignment.staff && assignment.ready && assignment.points.length > 1 && <Alert type="error" showIcon title="Tài khoản có nhiều điểm quét active. ADMIN cần xử lý phân công trước khi nhập/xuất." />}
    {pendingPointId && assignment.ready && !pendingAllowed && <Alert type="warning" showIcon title="Phân công đã thay đổi hoặc bị thu hồi. Lượt đang chờ vẫn giữ UUID và điểm quét gốc; kiểm tra lịch sử trước khi xử lý tiếp." />}
  </Space>;
}
