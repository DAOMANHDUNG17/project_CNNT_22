import { Alert, Button, Empty, Space, Spin, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, CheckCircleOutlined, PauseCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import type { Page } from '../lib/api';
import { errorMessage, integer } from '../lib/format';

export function PageHeading({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="page-heading"><h1>{title}</h1>{action && <div className="heading-actions">{action}</div>}</div>;
}
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  return <Alert className="error-notice" type="error" showIcon title={errorMessage(error)} action={retry && <Button size="small" onClick={retry}>Thử lại</Button>} />;
}
export function LoadingScreen() { return <div className="loading-screen"><Spin size="large" /><p>Đang kết nối kho của bạn…</p></div>; }
export function ActiveTag({ active }: { active: boolean }) { return <Tag className="status-tag" color={active ? 'success' : 'default'} icon={active ? <CheckCircleOutlined /> : <PauseCircleOutlined />}>{active ? 'Hoạt động' : 'Ngừng hoạt động'}</Tag>; }
export function MovementTag({ type }: { type: 'IN' | 'OUT' }) { return <Tag className="status-tag" color={type === 'IN' ? 'success' : 'warning'} icon={type === 'IN' ? <ArrowDownOutlined /> : <ArrowUpOutlined />}>{type === 'IN' ? 'Nhập kho' : 'Xuất kho'}</Tag>; }
export function ExactNumber({ value, unit }: { value: string; unit?: string }) { return <span className="exact-number">{integer(value)}{unit && <small> {unit}</small>}</span>; }
export function IdText({ value }: { value: string }) { return <Typography.Text className="id-text" copyable={{ text: value }}>{value}</Typography.Text>; }
export function RefreshButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) { return <Button icon={<ReloadOutlined />} onClick={onClick} loading={loading}>Làm mới</Button>; }
export function DataTable<T extends object>({ page, loading, onPage, ...props }: Omit<TableProps<T>, 'pagination'> & {
  page?: Page<T>; onPage: (page: number, limit: number) => void;
}) {
  return <Table<T> {...props} className={['data-table', props.className].filter(Boolean).join(' ')} loading={loading} dataSource={page?.data ?? []} size="middle" scroll={{ x: 'max-content' }}
    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu phù hợp" /> }}
    pagination={{ current: page?.pagination.page ?? 1, pageSize: page?.pagination.limit ?? 20,
      total: page?.pagination.total ?? 0, showSizeChanger: true, pageSizeOptions: [10,20,50,100],
      showTotal: total => `${total.toLocaleString('vi-VN')} kết quả`, onChange: onPage }} />;
}
export function PanelTitle({ title, description, extra }: { title: string; description?: string; extra?: ReactNode }) {
  return <div className="panel-title"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{extra && <Space wrap>{extra}</Space>}</div>;
}
