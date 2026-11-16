import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Checkbox, Empty, Radio, Space, Spin, Typography } from 'antd';
import { useResource } from '../hooks/useResource';
import { listDatabaseScanPoints } from '../lib/scan-points-api';
import { activeGrantIds, getUserScanPointAccess } from '../lib/scan-point-access-api';
import { ErrorNotice } from './Common';
import type { ManagedRole } from '../lib/users-api';

export interface ScanPointAccessState { ready: boolean; ids: string[]; savedIds: string[]; invalid: boolean }
export const initialScanPointAccess: ScanPointAccessState = { ready: false, ids: [], savedIds: [], invalid: false };
const emptyIds: string[] = [];

export function UserScanPointAccess({ userId, role, disabled, onChange }: { userId: string; role: ManagedRole; disabled: boolean; onChange: (state: ScanPointAccessState) => void }) {
  const resource = useResource(useCallback(async signal => {
    const [points, grants] = await Promise.all([listDatabaseScanPoints({ signal }), getUserScanPointAccess(userId, { signal })]);
    return { points: points.data, grants: grants.data };
  }, [userId]));
  const [selection, setSelection] = useState<{ data: typeof resource.data; ids: string[] }>();
  const savedIds = useMemo(() => resource.data ? activeGrantIds(resource.data.grants) : emptyIds, [resource.data]);
  useEffect(() => { if (resource.data) setSelection({ data: resource.data, ids: savedIds }); }, [resource.data, savedIds]);
  const ids = selection?.data && selection.data === resource.data ? selection.ids : emptyIds;
  const ready = !resource.loading && !resource.error && !!resource.data && selection?.data === resource.data;
  const invalid = (role === 'STAFF' && ids.length > 1) || ids.some(id => !resource.data?.points.some(point => point.scan_point_id === id && point.is_active));
  useEffect(() => { onChange({ ready, ids, savedIds, invalid }); }, [ready, ids, savedIds, invalid, onChange]);
  return <section aria-label="Quyền sử dụng điểm quét" style={{ marginBottom: 24 }}>
    <Typography.Text strong>Quyền sử dụng điểm quét</Typography.Text>
    <p className="muted">{role === 'STAFF' ? 'STAFF chỉ được phân công một điểm quét. Chọn Chưa phân công để thu hồi toàn bộ quyền.' : 'Chọn các điểm quét tài khoản được cấp quyền. Bỏ chọn tất cả để thu hồi toàn bộ quyền.'}</p>
    <ErrorNotice error={resource.error} retry={resource.reload} />
    <Spin spinning={resource.loading}>
      {resource.loading && <p>Đang tải quyền điểm quét…</p>}
      {resource.data && role === 'STAFF' && <Radio.Group aria-label="Phân công điểm quét STAFF" value={ids.length === 1 ? ids[0] : ids.length === 0 ? '' : undefined} disabled={disabled || !ready}
        onChange={event => setSelection({ data: resource.data, ids: event.target.value ? [event.target.value as string] : [] })}>
        <Space direction="vertical"><Radio value="">Chưa phân công</Radio>{resource.data.points.map(point => <Radio key={point.scan_point_id} value={point.scan_point_id} disabled={!point.is_active}>
          {point.scan_point_id} — {point.point_name}{!point.is_active && ' (Ngừng hoạt động)'}
        </Radio>)}</Space>
      </Radio.Group>}
      {resource.data && role !== 'STAFF' && <Checkbox.Group value={ids} disabled={disabled || !ready} onChange={values => setSelection({ data: resource.data, ids: values as string[] })}>
        <Space direction="vertical">{resource.data.points.map(point => <Checkbox key={point.scan_point_id} value={point.scan_point_id}
          disabled={!point.is_active && !ids.includes(point.scan_point_id)}>
          {point.scan_point_id} — {point.point_name}{!point.is_active && ' (Ngừng hoạt động)'}
        </Checkbox>)}</Space>
      </Checkbox.Group>}
      {resource.data?.points.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có điểm quét" />}
    </Spin>
    {invalid && <Alert type="warning" showIcon title={role === 'STAFF' ? 'Chọn tối đa một điểm quét đang hoạt động hoặc Chưa phân công trước khi lưu.' : 'Bỏ chọn điểm quét đã ngừng hoạt động trước khi lưu.'} />}
  </section>;
}
