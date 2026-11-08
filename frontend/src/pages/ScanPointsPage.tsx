import { useCallback, useState } from 'react';
import { Button, Card, Space, Typography } from 'antd';
import { EnvironmentOutlined, ScanOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { listDatabaseScanPoints } from '../lib/api';
import type { DatabaseScanPoint, Page } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useResource } from '../hooks/useResource';
import { ActiveTag, DataTable, ErrorNotice, PageHeading, RefreshButton } from '../components/Common';

export default function ScanPointsPage() {
  const { user } = useAuth();
  const [paging, setPaging] = useState({ page: 1, limit: 20 });
  const resource = useResource(useCallback(signal => listDatabaseScanPoints({ signal }), []));
  const total = resource.data?.count ?? 0;
  const page: Page<DatabaseScanPoint> | undefined = resource.data && {
    data: resource.data.data.slice((paging.page - 1) * paging.limit, paging.page * paging.limit),
    count: total,
    pagination: { page: paging.page, limit: paging.limit, total, totalPages: Math.ceil(total / paging.limit) },
  };

  return <div className="page-enter">
    <PageHeading title="Điểm quét" action={<RefreshButton onClick={resource.reload} loading={resource.loading} />} />
    <div className="station-banner"><span className="station-banner-icon"><EnvironmentOutlined /></span><div><h2>Mỗi trạm, một luồng công việc</h2><p>Các điểm ghi nhận đã sẵn sàng. Giao diện quét mã và nhập/xuất kho đang chờ An phát triển.</p></div><Tagline /></div>
    <Card className="content-card">
      <ErrorNotice error={resource.error} retry={resource.reload} />
      <DataTable<DatabaseScanPoint> rowKey="scan_point_id" page={page} loading={resource.loading}
        onPage={(pageNumber, limit) => setPaging({ page: pageNumber, limit })} columns={[
          { title: 'Mã điểm quét', dataIndex: 'scan_point_id', render: (value: string) => <strong className="id-text">{value}</strong> },
          { title: 'Tên điểm quét', dataIndex: 'point_name' },
          { title: 'Trạng thái', dataIndex: 'is_active', render: (value: boolean) => <ActiveTag active={value} /> },
          { title: 'Đường dẫn trạm', key: 'station', render: (_, row) =>
            <Typography.Text copyable={{ text: `${window.location.origin}/stock-movement?station=${encodeURIComponent(row.scan_point_id)}` }}>Cấu hình {row.scan_point_id}</Typography.Text> },
          { title: 'Thao tác', key: 'actions', render: (_, row) =>
            <Space>{user?.role !== 'VIEWER' && row.is_active &&
              <Link to={`/stock-movement?station=${encodeURIComponent(row.scan_point_id)}`}><Button size="small" icon={<ScanOutlined aria-hidden />}>Trang module</Button></Link>}</Space> },
        ]} />
    </Card>
  </div>;
}

function Tagline() { return <div className="station-banner-meta">TÀI KHOẢN CÓ QUYỀN<br /><strong>Thao tác được kiểm soát</strong></div>; }
