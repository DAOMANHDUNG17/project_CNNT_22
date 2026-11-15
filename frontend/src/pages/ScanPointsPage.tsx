import { useCallback, useState } from 'react';
import { Button, Card, Descriptions, Modal } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import { listDatabaseScanPoints } from '../lib/api';
import type { DatabaseScanPoint, Page } from '../lib/api';
import { useResource } from '../hooks/useResource';
import { ActiveTag, DataTable, ErrorNotice, PageHeading, RefreshButton } from '../components/Common';

export default function ScanPointsPage() {
  const [paging, setPaging] = useState({ page: 1, limit: 20 });
  const [selected, setSelected] = useState<DatabaseScanPoint | null>(null);
  const resource = useResource(useCallback(signal => listDatabaseScanPoints({ signal }), []));
  const total = resource.data?.count ?? 0;
  const page: Page<DatabaseScanPoint> | undefined = resource.data && {
    data: resource.data.data.slice((paging.page - 1) * paging.limit, paging.page * paging.limit),
    count: total,
    pagination: { page: paging.page, limit: paging.limit, total, totalPages: Math.ceil(total / paging.limit) },
  };

  return <div className="page-enter">
    <PageHeading title="Quản lý điểm quét" action={<RefreshButton onClick={resource.reload} loading={resource.loading} />} />
    <div className="station-banner"><span className="station-banner-icon"><EnvironmentOutlined /></span><div><h2>Danh sách điểm quét</h2><p>Đây là các điểm quét trong database. Chưa có ánh xạ tin cậy giữa điểm quét và trạm đang sử dụng.</p></div><Tagline /></div>
    <Card className="content-card">
      <ErrorNotice error={resource.error} retry={resource.reload} />
      <DataTable<DatabaseScanPoint> rowKey="scan_point_id" page={page} loading={resource.loading}
        onPage={(pageNumber, limit) => setPaging({ page: pageNumber, limit })} columns={[
          { title: 'Mã điểm quét', dataIndex: 'scan_point_id', render: (value: string) => <strong className="id-text">{value}</strong> },
          { title: 'Tên điểm quét', dataIndex: 'point_name' },
          { title: 'Trạng thái', dataIndex: 'is_active', render: (value: boolean) => <ActiveTag active={value} /> },
          { title: 'Thao tác', key: 'actions', render: (_, row) =>
            <Button size="small" onClick={() => setSelected(row)}>Xem chi tiết</Button> },
        ]} />
    </Card>
    <Modal title="Chi tiết điểm quét" open={!!selected} onCancel={() => setSelected(null)} footer={null} destroyOnHidden>
      {selected && <Descriptions bordered column={1} items={[
        { key: 'id', label: 'Mã điểm quét', children: selected.scan_point_id },
        { key: 'name', label: 'Tên điểm quét', children: selected.point_name },
        { key: 'active', label: 'Trạng thái', children: <ActiveTag active={selected.is_active} /> },
      ]} />}
    </Modal>
  </div>;
}

function Tagline() { return <div className="station-banner-meta">QUẢN TRỊ VIÊN<br /><strong>Danh sách từ backend</strong></div>; }
