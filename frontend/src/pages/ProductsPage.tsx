import { useCallback, useMemo, useState } from 'react';
import { Button, Card, Descriptions, Drawer, Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { listDatabaseProducts } from '../lib/api';
import type { DatabaseProduct, Page } from '../lib/api';
import { useDebounced, useResource } from '../hooks/useResource';
import { timestamp } from '../lib/format';
import { ActiveTag, DataTable, ErrorNotice, IdText, PageHeading, RefreshButton } from '../components/Common';

export default function ProductsPage() {
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim().toLowerCase());
  const [paging, setPaging] = useState({ page: 1, limit: 20 });
  const [selected, setSelected] = useState<string>();
  const list = useResource(useCallback(signal => listDatabaseProducts({ signal }), []));

  const filtered = useMemo(() => (list.data?.data ?? []).filter(product =>
    !query || `${product.product_id} ${product.product_name}`.toLowerCase().includes(query),
  ), [list.data, query]);
  const total = query ? filtered.length : (list.data?.count ?? 0);
  const page: Page<DatabaseProduct> | undefined = list.data && {
    data: filtered.slice((paging.page - 1) * paging.limit, paging.page * paging.limit),
    count: total,
    pagination: {
      page: paging.page,
      limit: paging.limit,
      total,
      totalPages: Math.ceil(total / paging.limit),
    },
  };
  const product = list.data?.data.find(row => row.product_id === selected);

  return <div className="page-enter">
    <PageHeading title="Sản phẩm & đơn vị" action={<RefreshButton onClick={list.reload} loading={list.loading} />} />
    <Card className="content-card">
      <div className="table-toolbar">
        <Input aria-label="Tìm sản phẩm" prefix={<SearchOutlined />} placeholder="Tìm mã hoặc tên sản phẩm…" allowClear maxLength={150}
          value={search} onChange={event => { setSearch(event.target.value); setPaging(current => ({ ...current, page: 1 })); }} />
        <span className="muted">Danh mục và trạng thái từ hệ thống kho</span>
      </div>
      <ErrorNotice error={list.error} retry={list.reload} />
      <DataTable<DatabaseProduct> rowKey="product_id" page={page} loading={list.loading}
        onPage={(pageNumber, limit) => setPaging({ page: pageNumber, limit })} columns={[
          { title: 'Mã sản phẩm', dataIndex: 'product_id', render: (value: string) =>
            <Button type="link" className="table-link" onClick={() => setSelected(value)}>{value}</Button> },
          { title: 'Tên sản phẩm', dataIndex: 'product_name', render: (value: string) => <strong>{value}</strong> },
          { title: 'Đơn vị cơ sở', dataIndex: 'base_unit' },
          { title: 'Trạng thái', dataIndex: 'is_active', render: (value: boolean) => <ActiveTag active={value} /> },
          { title: 'Ngày tạo (UTC+7)', dataIndex: 'created_at', render: timestamp },
          { title: 'Thao tác', key: 'actions', render: (_, row) =>
            <Button size="small" onClick={() => setSelected(row.product_id)}>Chi tiết</Button> },
        ]} />
    </Card>
    <Drawer open={!!selected} onClose={() => setSelected(undefined)} title="Chi tiết sản phẩm" size={760} destroyOnHidden>
      {product && <Descriptions column={1} bordered items={[
        { key: 'id', label: 'Mã sản phẩm', children: <IdText value={product.product_id} /> },
        { key: 'name', label: 'Tên sản phẩm', children: product.product_name },
        { key: 'base', label: 'Đơn vị cơ sở', children: product.base_unit },
        { key: 'status', label: 'Trạng thái', children: <ActiveTag active={product.is_active} /> },
        { key: 'updated', label: 'Cập nhật (UTC+7)', children: timestamp(product.updated_at) },
      ]} />}
    </Drawer>
  </div>;
}
