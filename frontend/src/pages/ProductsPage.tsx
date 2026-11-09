import { useCallback, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Descriptions, Drawer, Form, Input, InputNumber, Modal, Space, Switch, Table } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { createDatabaseProduct, createDatabaseProductUnit, listDatabaseProductUnits, listDatabaseProducts, updateDatabaseProduct, updateDatabaseProductUnit } from '../lib/api';
import type { CreateProductRequest, CreateProductUnitRequest, DatabaseProduct, DatabaseProductUnit, Page, PatchProductRequest, PatchProductUnitRequest } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useDebounced, useMutation, useResource } from '../hooks/useResource';
import { textRules, timestamp } from '../lib/format';
import { ActiveTag, DataTable, ErrorNotice, IdText, PageHeading, PanelTitle, RefreshButton } from '../components/Common';

export default function ProductsPage() {
  const { message, modal } = App.useApp();
  const { user } = useAuth();
  const admin = user?.role === 'ADMIN';
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim().toLowerCase());
  const [paging, setPaging] = useState({ page: 1, limit: 20 });
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [creatingUnit, setCreatingUnit] = useState(false);
  const [editingProduct, setEditingProduct] = useState(false);
  const [editingUnit, setEditingUnit] = useState<DatabaseProductUnit>();
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [confirmingUnitEdit, setConfirmingUnitEdit] = useState(false);
  const [form] = Form.useForm<CreateProductRequest>();
  const [unitForm] = Form.useForm<CreateProductUnitRequest>();
  const [editForm] = Form.useForm<PatchProductRequest>();
  const [editUnitForm] = Form.useForm<PatchProductUnitRequest>();
  const mutation = useMutation();
  const unitMutation = useMutation();
  const editMutation = useMutation();
  const editUnitMutation = useMutation();
  const isBaseUnit = Form.useWatch('is_base_unit', unitForm);
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
  const hasBaseUnit = productUnits.some(row => row.is_base_unit);

  async function save(values: CreateProductRequest) {
    await mutation.run(
      () => createDatabaseProduct(values),
      'Đã thêm sản phẩm. Tồn kho bắt đầu từ 0; chưa có đơn vị đóng gói hoặc mã quét.',
      () => { setCreating(false); form.resetFields(); list.reload(); },
    );
  }

  async function saveUnit(values: CreateProductUnitRequest) {
    if (!product || !admin) return;
    await unitMutation.run(
      () => createDatabaseProductUnit({
        product_id: product.product_id,
        unit_name: values.unit_name.trim(),
        conversion_factor: values.conversion_factor,
        scan_code: values.scan_code.trim(),
        is_base_unit: values.is_base_unit,
      }),
      'Đã thêm đơn vị đóng gói.',
      () => { setCreatingUnit(false); unitForm.resetFields(); units.reload(); },
    );
  }

  async function saveEdit(values: PatchProductRequest) {
    if (!product || !admin || editMutation.busy || confirmingDeactivate) return;
    const patch: PatchProductRequest = {};
    const name = values.product_name?.trim();
    if (name !== product.product_name) patch.product_name = name;
    if (values.is_active !== product.is_active) patch.is_active = values.is_active;
    if (Object.keys(patch).length === 0) { setEditingProduct(false); return; }

    const persist = () => editMutation.run(
      () => updateDatabaseProduct(product.product_id, patch),
      'Đã cập nhật sản phẩm.',
      () => { setEditingProduct(false); editForm.resetFields(); list.reload(); },
    );
    if (patch.is_active === false) {
      setConfirmingDeactivate(true);
      modal.confirm({
        title: 'Ngừng hoạt động sản phẩm?',
        content: 'Chỉ có thể ngừng hoạt động khi tồn kho bằng 0. Sản phẩm đang có tồn kho sẽ bị từ chối.',
        okText: 'Xác nhận ngừng', cancelText: 'Hủy', okType: 'danger', zIndex: 1200,
        onOk: async () => { setConfirmingDeactivate(false); await persist(); },
        onCancel: () => setConfirmingDeactivate(false),
      });
      return;
    }
    await persist();
  }

  async function saveUnitEdit(values: PatchProductUnitRequest) {
    if (!editingUnit || !admin || editUnitMutation.busy || confirmingUnitEdit) return;
    const patch: PatchProductUnitRequest = {};
    const unitName = values.unit_name?.trim();
    const scanCode = values.scan_code?.trim();
    const baseNeedsSync = editingUnit.is_base_unit && product?.base_unit !== editingUnit.unit_name;
    if (unitName && (editingUnit.is_base_unit
      ? unitName !== editingUnit.unit_name.trim() || baseNeedsSync
      : unitName.toLocaleLowerCase() !== editingUnit.unit_name.trim().toLocaleLowerCase())) patch.unit_name = unitName;
    if (scanCode && scanCode !== editingUnit.scan_code) patch.scan_code = scanCode;
    if (!editingUnit.is_base_unit && values.conversion_factor !== editingUnit.conversion_factor) {
      patch.conversion_factor = values.conversion_factor;
    }
    if (Object.keys(patch).length === 0) { message.info('Không có thay đổi để lưu'); return; }
    const renamingBaseUnit = editingUnit.is_base_unit && patch.unit_name !== undefined;

    const persist = () => editUnitMutation.run(
      () => updateDatabaseProductUnit(editingUnit.product_unit_id, patch),
      'Đã cập nhật đơn vị đóng gói.',
      () => { setEditingUnit(undefined); editUnitForm.resetFields(); units.reload(); if (renamingBaseUnit) list.reload(); },
    );
    if (renamingBaseUnit || patch.scan_code !== undefined) {
      setConfirmingUnitEdit(true);
      modal.confirm({
        title: renamingBaseUnit ? 'Xác nhận đổi tên đơn vị cơ sở?' : 'Xác nhận thay đổi mã quét?',
        content: <>
          {renamingBaseUnit && <p>Chỉ đổi cách gọi của cùng một đơn vị cơ sở. Không sử dụng chức năng này để thay đổi quy cách đóng gói hoặc số lượng quy đổi.</p>}
          {baseNeedsSync && <p>Tên đơn vị cơ sở hiện khác dữ liệu sản phẩm. Hãy kiểm tra tên trước khi đồng bộ.</p>}
          {patch.scan_code !== undefined && <p>Thay đổi mã quét có thể khiến các tem mã vạch cũ không còn sử dụng được. Hãy cập nhật tem trên hàng hóa.</p>}
        </>,
        okText: 'Xác nhận thay đổi', cancelText: 'Hủy', zIndex: 1200,
        onOk: async () => { setConfirmingUnitEdit(false); await persist(); },
        onCancel: () => setConfirmingUnitEdit(false),
      });
      return;
    }
    await persist();
  }

  const editUnitTextRules = (max: number) => [{ required: true, message: 'Vui lòng nhập thông tin.' }, {
    validator: (_: unknown, value: unknown) => typeof value === 'string' && [...value.trim()].length > 0
      && [...value.trim()].length <= max && !value.includes('\0')
      ? Promise.resolve() : Promise.reject(new Error(`Nhập 1–${max} ký tự.`)),
  }];

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
    <Drawer open={!!selected} onClose={() => { if (!unitMutation.busy && !editMutation.busy && !editUnitMutation.busy && !confirmingDeactivate && !confirmingUnitEdit) { setCreatingUnit(false); setEditingProduct(false); setEditingUnit(undefined); setSelected(undefined); } }} title="Chi tiết sản phẩm" size={760} destroyOnHidden>
      {product && <Descriptions column={1} bordered items={[
        { key: 'id', label: 'Mã sản phẩm', children: <IdText value={product.product_id} /> },
        { key: 'name', label: 'Tên sản phẩm', children: product.product_name },
        { key: 'base', label: 'Đơn vị cơ sở', children: product.base_unit },
        { key: 'status', label: 'Trạng thái', children: <ActiveTag active={product.is_active} /> },
        { key: 'updated', label: 'Cập nhật (UTC+7)', children: timestamp(product.updated_at) },
      ]} />}
      {product && admin && <Button style={{ marginTop: 12 }} onClick={() => {
        editForm.setFieldsValue({ product_name: product.product_name, is_active: product.is_active });
        setEditingProduct(true);
      }}>Chỉnh sửa sản phẩm</Button>}
      {product && <div className="drawer-section">
        <PanelTitle title="Đơn vị & mã quét" description="Hệ số quy đổi được lấy từ dữ liệu sản phẩm trong kho." />
        {!units.loading && !units.error && !hasBaseUnit && <Alert type="info" showIcon message="Sản phẩm chưa có đơn vị cơ sở. Hãy khai báo đơn vị cơ sở trước khi thêm đơn vị đóng gói khác." style={{ marginBottom: 12 }} />}
        {admin && product.is_active && <Button icon={<PlusOutlined aria-hidden />} disabled={units.loading || !!units.error} onClick={() => {
          unitForm.resetFields();
          unitForm.setFieldsValue({ product_id: product.product_id, is_base_unit: !hasBaseUnit, conversion_factor: !hasBaseUnit ? 1 : undefined, unit_name: !hasBaseUnit ? product.base_unit : undefined });
          setCreatingUnit(true);
        }} style={{ marginBottom: 12 }}>Thêm đơn vị đóng gói / mã quét</Button>}
        <ErrorNotice error={units.error} retry={units.reload} />
        <Table<DatabaseProductUnit> rowKey="product_unit_id" dataSource={productUnits} loading={units.loading}
          pagination={false} scroll={{ x: 'max-content' }} locale={{ emptyText: 'Chưa có đơn vị đóng gói' }} columns={[
            { title: 'Đơn vị', dataIndex: 'unit_name' },
            { title: 'Quy đổi', dataIndex: 'conversion_factor', render: (value: number) => `${value.toLocaleString('vi-VN')} ${product.base_unit}` },
            { title: 'Mã quét', dataIndex: 'scan_code', render: (value: string) => <IdText value={value} /> },
            { title: 'Cơ sở', dataIndex: 'is_base_unit', render: (value: boolean) => value ? 'Có' : '—' },
            ...(admin ? [{ title: 'Thao tác', key: 'actions', render: (_: unknown, row: DatabaseProductUnit) =>
              <Button size="small" onClick={() => {
                editUnitForm.setFieldsValue({ unit_name: row.unit_name, scan_code: row.scan_code, conversion_factor: row.conversion_factor });
                setEditingUnit(row);
              }}>Chỉnh sửa đơn vị</Button> }] : []),
          ]} />
      </div>}
    </Drawer>
    <Modal open={editingProduct} title="Chỉnh sửa sản phẩm" footer={null} forceRender zIndex={1100}
      closable={!editMutation.busy && !confirmingDeactivate} maskClosable={!editMutation.busy && !confirmingDeactivate}
      onCancel={() => { if (!editMutation.busy && !confirmingDeactivate) setEditingProduct(false); }}>
      {product && <Form form={editForm} layout="vertical" requiredMark={false}
        onFinish={values => { void saveEdit(values); }}>
        <p className="muted">Chỉ đổi tên khi sản phẩm vẫn là cùng một mặt hàng.</p>
        <Form.Item label="Mã sản phẩm"><Input aria-label="Mã sản phẩm" value={product.product_id} readOnly /></Form.Item>
        <Form.Item name="product_name" label="Tên sản phẩm" rules={textRules(150)}><Input maxLength={150} /></Form.Item>
        <Form.Item label="Đơn vị cơ sở"><Input aria-label="Đơn vị cơ sở" value={product.base_unit} readOnly /></Form.Item>
        <Form.Item name="is_active" label="Trạng thái hoạt động" valuePropName="checked"><Switch checkedChildren="Đang hoạt động" unCheckedChildren="Ngừng hoạt động" /></Form.Item>
        <div className="modal-actions">
          <Button disabled={editMutation.busy || confirmingDeactivate} onClick={() => setEditingProduct(false)}>Hủy</Button>
          <Button type="primary" htmlType="submit" loading={editMutation.busy} disabled={editMutation.busy || confirmingDeactivate}>Lưu thay đổi</Button>
        </div>
      </Form>}
    </Modal>
    <Modal open={!!editingUnit} title="Chỉnh sửa đơn vị" footer={null} forceRender zIndex={1100}
      closable={!editUnitMutation.busy && !confirmingUnitEdit} maskClosable={!editUnitMutation.busy && !confirmingUnitEdit}
      onCancel={() => { if (!editUnitMutation.busy && !confirmingUnitEdit) setEditingUnit(undefined); }}>
      {editingUnit && <Form form={editUnitForm} layout="vertical" requiredMark={false}
        onFinish={values => { void saveUnitEdit(values); }}>
        <Form.Item label="ID đơn vị"><Input aria-label="ID đơn vị" value={editingUnit.product_unit_id} readOnly /></Form.Item>
        <Form.Item label="Sản phẩm"><Input aria-label="Sản phẩm" value={`${editingUnit.product_id} — ${editingUnit.product_name}`} readOnly /></Form.Item>
        <Form.Item name="unit_name" label="Đơn vị" rules={editUnitTextRules(30)}><Input aria-label="Đơn vị" maxLength={30} /></Form.Item>
        {editingUnit.is_base_unit && <Alert type="warning" showIcon message="Chỉ đổi cách gọi của cùng một đơn vị cơ sở. Không sử dụng chức năng này để thay đổi quy cách đóng gói hoặc số lượng quy đổi." style={{ marginBottom: 16 }} />}
        {editingUnit.is_base_unit && product?.base_unit !== editingUnit.unit_name && <p className="muted">Tên đơn vị cơ sở hiện khác dữ liệu sản phẩm. Hãy kiểm tra tên trước khi đồng bộ.</p>}
        <Form.Item name="scan_code" label="Mã quét" rules={editUnitTextRules(80)}><Input aria-label="Mã quét" maxLength={80} /></Form.Item>
        <Form.Item name="conversion_factor" label={`Hệ số quy đổi (${product?.base_unit ?? ''})`}
          rules={[{ required: true, message: 'Vui lòng nhập hệ số quy đổi.' }, {
            validator: (_: unknown, value: number) => Number.isInteger(value) && value >= 1 && value <= 2147483647
              ? Promise.resolve() : Promise.reject(new Error('Nhập số nguyên từ 1 đến 2147483647.')),
          }]}><InputNumber aria-label="Hệ số quy đổi" min={1} max={2147483647} precision={0} disabled={editingUnit.is_base_unit} style={{ width: '100%' }} /></Form.Item>
        {editingUnit.is_base_unit && <p className="muted">Đơn vị cơ sở có hệ số quy đổi bằng 1.</p>}
        <div className="modal-actions">
          <Button disabled={editUnitMutation.busy || confirmingUnitEdit} onClick={() => setEditingUnit(undefined)}>Hủy</Button>
          <Button type="primary" htmlType="submit" loading={editUnitMutation.busy} disabled={editUnitMutation.busy || confirmingUnitEdit}>Lưu thay đổi</Button>
        </div>
      </Form>}
    </Modal>
    <Modal open={creatingUnit} title="Thêm đơn vị đóng gói / mã quét" footer={null} forceRender zIndex={1100}
      closable={!unitMutation.busy} maskClosable={!unitMutation.busy}
      onCancel={() => { if (!unitMutation.busy) setCreatingUnit(false); }}>
      {product && <Form form={unitForm} layout="vertical" requiredMark={false} initialValues={{ is_base_unit: false }}
        onFinish={values => { void saveUnit(values); }}>
        <p className="muted">Sản phẩm: {product.product_id} — {product.product_name}</p>
        <Form.Item name="unit_name" label="Đơn vị" rules={[...textRules(30), {
          validator: (_: unknown, value: string) => !isBaseUnit || value?.trim().toLocaleLowerCase() === product.base_unit.trim().toLocaleLowerCase()
            ? Promise.resolve() : Promise.reject(new Error(`Đơn vị cơ sở phải trùng “${product.base_unit}”.`)),
        }]}><Input maxLength={30} placeholder={product.base_unit} /></Form.Item>
        <Form.Item name="is_base_unit" valuePropName="checked"><Checkbox disabled={hasBaseUnit} onChange={event => {
          if (event.target.checked) unitForm.setFieldsValue({ unit_name: product.base_unit, conversion_factor: 1 });
        }}>Đơn vị cơ sở ({product.base_unit})</Checkbox></Form.Item>
        {isBaseUnit && <p className="muted">Đơn vị cơ sở phải là “{product.base_unit}” và hệ số quy đổi bằng 1.</p>}
        <Form.Item name="conversion_factor" label={`Hệ số quy đổi (${product.base_unit})`} rules={[{ required: true, message: 'Vui lòng nhập hệ số quy đổi.' }, {
          validator: (_: unknown, value: number) => Number.isInteger(value) && value >= 1 && value <= 2147483647 && (!isBaseUnit || value === 1)
            ? Promise.resolve() : Promise.reject(new Error(isBaseUnit ? 'Đơn vị cơ sở phải có hệ số 1.' : 'Nhập số nguyên từ 1 đến 2147483647.')),
        }]}><InputNumber min={1} max={2147483647} precision={0} disabled={isBaseUnit} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="scan_code" label="Mã quét" rules={textRules(80)}><Input maxLength={80} /></Form.Item>
        <div className="modal-actions">
          <Button disabled={unitMutation.busy} onClick={() => setCreatingUnit(false)}>Hủy</Button>
          <Button type="primary" htmlType="submit" loading={unitMutation.busy} disabled={unitMutation.busy}>Lưu đơn vị</Button>
        </div>
      </Form>}
    </Modal>
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
