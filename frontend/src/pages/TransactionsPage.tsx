import { useCallback, useState } from 'react';
import { Alert, App, Button, Card, DatePicker, Descriptions, Drawer, Input, Select, Space, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { CopyOutlined, SearchOutlined } from '@ant-design/icons';
import { listDatabaseScanPoints } from '../lib/scan-points-api';
import { historyDateRange, listDatabaseTransactions } from '../lib/transactions-api';
import type { TransactionsQuery } from '../lib/transactions-api';
import type { DatabaseTransaction } from '../lib/api-types';
import { useDebounced, useResource } from '../hooks/useResource';
import { integer, timestamp } from '../lib/format';
import { DataTable, ErrorNotice, MovementTag, PageHeading, RefreshButton } from '../components/Common';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const description = (value: string | null) => value ?? 'Thiếu thông tin liên kết';

export default function TransactionsPage() {
  const { message } = App.useApp();
  const [query, setQuery] = useState<TransactionsQuery>({ page: 1, limit: 20 });
  const settled = useDebounced(query);
  const [dates, setDates] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [selected, setSelected] = useState<DatabaseTransaction>();
  const points = useResource(useCallback(signal => listDatabaseScanPoints({ signal }), []));
  const uuid = settled.transactionId?.trim();
  const validUuid = !uuid || uuidPattern.test(uuid);
  const list = useResource(useCallback(signal => validUuid ? listDatabaseTransactions({
    ...settled, transactionId: uuid || undefined, productId: settled.productId?.trim() || undefined,
  }, { signal }) : Promise.resolve({ data: [], count: 0, pagination: { page: 1, limit: settled.limit ?? 20, total: 0, totalPages: 0 } }), [settled, uuid, validUuid]));
  const filter = (values: Partial<TransactionsQuery>) => setQuery(current => ({ ...current, ...values, page: 1 }));
  function reset() { setQuery({ page: 1, limit: query.limit ?? 20 }); setDates(null); }
  async function copyUuid(value: string) {
    try { await navigator.clipboard.writeText(value); message.success('Đã sao chép đầy đủ UUID.'); }
    catch { message.error('Không thể sao chép UUID. Vui lòng chọn và sao chép mã trong chi tiết.'); }
  }
  const missingDescriptions = list.data?.data.some(row => [row.product_name, row.unit_name, row.point_name, row.display_name].includes(null));

  return <div className="page-enter"><PageHeading title="Giao dịch" action={<RefreshButton onClick={list.reload} loading={list.loading} />} />
    <Card className="content-card"><div className="table-toolbar">
      <Space wrap>
        <Input aria-label="Tìm UUID giao dịch" maxLength={36} prefix={<SearchOutlined />} placeholder="UUID giao dịch chính xác" allowClear value={query.transactionId ?? ''} status={validUuid ? '' : 'error'} onChange={event => filter({ transactionId: event.target.value })} style={{ width: 310 }} />
        <Input aria-label="Lọc mã sản phẩm" maxLength={20} placeholder="Mã sản phẩm chính xác" allowClear value={query.productId ?? ''} onChange={event => filter({ productId: event.target.value })} style={{ width: 220 }} />
        <Select aria-label="Loại giao dịch" placeholder="Mọi loại giao dịch" allowClear value={query.movementType} style={{ minWidth: 170 }} options={[{ value: 'IN', label: 'Nhập kho' }, { value: 'OUT', label: 'Xuất kho' }]} onChange={value => filter({ movementType: value })} />
        <Select aria-label="Lọc điểm quét" placeholder="Mọi điểm quét" value={query.scanPointId} loading={points.loading} allowClear style={{ minWidth: 200 }} options={points.data?.data.map(point => ({ value: point.scan_point_id, label: `${point.scan_point_id} · ${point.point_name}` }))} onChange={value => filter({ scanPointId: value })} />
        <DatePicker.RangePicker aria-label="Khoảng ngày UTC+7" value={dates} format="DD/MM/YYYY" placeholder={['Từ ngày (UTC+7)', 'Đến hết ngày (UTC+7)']} onChange={value => {
          setDates(value);
          filter(value?.[0] && value[1] ? historyDateRange(value[0].format('YYYY-MM-DD'), value[1].add(1, 'day').format('YYYY-MM-DD')) : { from: undefined, to: undefined });
        }} />
        <Button onClick={reset}>Xóa bộ lọc</Button>
      </Space>
    </div>
      {!validUuid && <Alert type="warning" showIcon title="Nhập UUID hợp lệ gồm 36 ký tự để tìm chính xác giao dịch." />}
      {missingDescriptions && <Alert type="warning" showIcon title="Có giao dịch thiếu thông tin liên kết. Dữ liệu snapshot vẫn được giữ nguyên." />}
      <ErrorNotice error={points.error} retry={points.reload} /><ErrorNotice error={list.error} retry={list.reload} />
      <DataTable<DatabaseTransaction> rowKey="transaction_id" page={list.data} loading={list.loading} onPage={(page, limit) => setQuery(current => ({ ...current, page, limit }))} columns={[
        { title: 'UUID', dataIndex: 'transaction_id', render: (value: string, row) => <Space><Button type="link" onClick={() => setSelected(row)} title={value}>{value.slice(0, 8)}…</Button><Button size="small" aria-label={`Copy UUID ${value}`} icon={<CopyOutlined />} onClick={() => { void copyUuid(value); }} /></Space> },
        { title: 'Thời gian (UTC+7)', dataIndex: 'created_at', render: timestamp },
        { title: 'Sản phẩm', dataIndex: 'product_name', render: (value: string | null, row) => <div className="cell-product"><strong>{description(value)}</strong><small>{row.product_id}</small></div> },
        { title: 'Loại', dataIndex: 'movement_type', render: (value: 'IN' | 'OUT') => <MovementTag type={value} /> },
        { title: 'Số gói', dataIndex: 'quantity_packages', align: 'right', render: (value: number, row) => `${value.toLocaleString('vi-VN')} ${description(row.unit_name)}` },
        { title: 'Số lượng cơ sở', dataIndex: 'quantity_base', align: 'right', render: (value: string, row) => `${row.movement_type === 'IN' ? '+' : '-'}${integer(value)}` },
        { title: 'Tồn sau giao dịch', dataIndex: 'inventory_after', align: 'right', render: integer },
        { title: 'Điểm quét', dataIndex: 'point_name', render: (value: string | null, row) => <div className="cell-product"><span>{description(value)}</span><small>{row.scan_point_id}</small></div> },
        { title: 'Người thực hiện', dataIndex: 'display_name', render: (value: string | null, row) => <div className="cell-product"><span>{description(value)}</span><small>{row.user_id}</small></div> },
        { title: 'Thao tác', key: 'actions', render: (_, row) => <Button size="small" onClick={() => setSelected(row)}>Chi tiết</Button> },
      ]} />
    </Card>
    <Drawer title="Chi tiết giao dịch" open={!!selected} onClose={() => setSelected(undefined)} size={620} destroyOnHidden>{selected && <>
      <p className="muted">Số lượng, mã quét và hệ số là snapshot đã lưu. Tồn sau giao dịch có thể khác tồn hiện tại. Tên sản phẩm, đơn vị và người thực hiện là thông tin hiện tại.</p>
      <Descriptions bordered column={1} items={[
        { key: 'id', label: 'Mã giao dịch', children: <Space direction="vertical"><Typography.Text style={{ wordBreak: 'break-all' }}>{selected.transaction_id}</Typography.Text><Button aria-label="Copy UUID" icon={<CopyOutlined aria-hidden />} onClick={() => { void copyUuid(selected.transaction_id); }}>Copy UUID</Button></Space> },
        { key: 'product', label: 'Sản phẩm', children: `${selected.product_id} · ${description(selected.product_name)}` },
        { key: 'unit', label: 'Đơn vị đóng gói', children: `${selected.product_unit_id} · ${description(selected.unit_name)}` },
        { key: 'scan', label: 'Mã quét snapshot', children: selected.scan_code_snapshot },
        { key: 'type', label: 'Loại', children: <MovementTag type={selected.movement_type} /> },
        { key: 'packages', label: 'Số gói', children: selected.quantity_packages.toLocaleString('vi-VN') },
        { key: 'factor', label: 'Hệ số tại thời điểm ghi', children: selected.conversion_factor_snapshot.toLocaleString('vi-VN') },
        { key: 'quantity', label: 'Số lượng cơ sở', children: integer(selected.quantity_base) },
        { key: 'before', label: 'Tồn trước giao dịch', children: integer(selected.inventory_before) },
        { key: 'after', label: 'Tồn sau giao dịch', children: integer(selected.inventory_after) },
        { key: 'point', label: 'Điểm quét', children: `${selected.scan_point_id} · ${description(selected.point_name)}` },
        { key: 'user', label: 'Người thực hiện', children: `${selected.user_id} · ${description(selected.display_name)}` },
        { key: 'time', label: 'Thời gian (UTC+7)', children: timestamp(selected.created_at) },
      ]} />
    </>}</Drawer>
  </div>;
}
