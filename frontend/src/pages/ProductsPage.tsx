import { useCallback, useMemo, useState } from 'react';
import { Button, Card, Descriptions, Drawer, Form, Input, Modal, Space, Table } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { createDatabaseProduct, listDatabaseProductUnits, listDatabaseProducts } from '../lib/api';
import type { CreateProductRequest, DatabaseProduct, DatabaseProductUnit, Page } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useDebounced, useMutation, useResource } from '../hooks/useResource';
import { textRules, timestamp } from '../lib/format';
import { ActiveTag, DataTable, ErrorNotice, IdText, PageHeading, PanelTitle, RefreshButton } from '../components/Common';

export default function ProductsPage() {
  const { user } = useAuth();
  const admin = user?.role === 'ADMIN';
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim().toLowerCase());
  const [paging, setPaging] = useState({ page: 1, limit: 20 });
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<CreateProductRequest>();
  const mutation = useMutation();
  const list = useResource(useCallback(signal => listDatabaseProducts({ signal }), []));
  const units = useResource(useCallback(signal => selected
    ? listDatabaseProductUnits({ signal }) : Promise.resolve(undefined), [selected]));

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
  const productUnits = units.data?.data.filter(row => row.product_id === selected) ?? [];

  async function save(values: CreateProductRequest) {
    await mutation.run(
      () => createDatabaseProduct(values),
      'Đã thêm sản phẩm. Tồn kho bắt đầu từ 0; chưa có đơn vị đóng gói hoặc mã quét.',
      () => { setCreating(false); form.resetFields(); list.reload(); },
    );
  }

  return <div className="page-enter">
    <PageHeading title="Sản phẩm & đơn vị" action={<Space>
      <RefreshButton onClick={list.reload} loading={list.loading} />
      {admin && <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={() => { form.resetFields(); setCreating(true); }}>Thêm sản phẩm</Button>}
    </Space>} />
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
      {product && <div className="drawer-section">
        <PanelTitle title="Đơn vị & mã quét" description="Hệ số quy đổi được lấy từ dữ liệu sản phẩm trong kho." />
        <ErrorNotice error={units.error} retry={units.reload} />
        <Table<DatabaseProductUnit> rowKey="product_unit_id" dataSource={productUnits} loading={units.loading}
          pagination={false} scroll={{ x: 'max-content' }} locale={{ emptyText: 'Chưa có đơn vị đóng gói' }} columns={[
            { title: 'Đơn vị', dataIndex: 'unit_name' },
            { title: 'Quy đổi', dataIndex: 'conversion_factor', render: (value: number) => `${value.toLocaleString('vi-VN')} ${product.base_unit}` },
            { title: 'Mã quét', dataIndex: 'scan_code', render: (value: string) => <IdText value={value} /> },
            { title: 'Cơ sở', dataIndex: 'is_base_unit', render: (value: boolean) => value ? 'Có' : '—' },
          ]} />
      </div>}
    </Drawer>
    <Modal open={creating} title="Thêm sản phẩm" footer={null} forceRender
      closable={!mutation.busy} maskClosable={!mutation.busy}
      onCancel={() => { if (!mutation.busy) setCreating(false); }}>
      <p className="muted">Đây là đầu mục sản phẩm, chưa phải nhập kho. Tồn kho bắt đầu từ 0; đơn vị đóng gói và mã quét được cấu hình sau.</p>
      <Form form={form} layout="vertical" requiredMark={false} clearOnDestroy
        onFinish={values => { void save(values); }}>
        <Form.Item name="product_id" label="Mã sản phẩm" rules={textRules(20)}><Input maxLength={20} autoFocus /></Form.Item>
        <Form.Item name="product_name" label="Tên sản phẩm" rules={textRules(150)}><Input maxLength={150} /></Form.Item>
        <Form.Item name="base_unit" label="Đơn vị cơ sở" rules={textRules(30)}><Input maxLength={30} /></Form.Item>
        <div className="modal-actions">
          <Button disabled={mutation.busy} onClick={() => setCreating(false)}>Hủy</Button>
          <Button aria-label="Lưu sản phẩm" type="primary" htmlType="submit" loading={mutation.busy} disabled={mutation.busy}>Lưu sản phẩm</Button>
        </div>
      </Form>
    </Modal>
  </div>;
}
