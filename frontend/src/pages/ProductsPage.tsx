import { useCallback, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Descriptions, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Space, Table } from 'antd';
import { EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '../lib/api';
import type { Product, ProductCreate, ProductPatch, ProductUnit, UnitCreate } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useDebounced, useMutation, useResource } from '../hooks/useResource';
import { textRules, timestamp } from '../lib/format';
import { ActiveTag, DataTable, ErrorNotice, IdText, PageHeading, PanelTitle, RefreshButton } from '../components/Common';

export default function ProductsPage() {
  const { user } = useAuth(), { message } = App.useApp();
  const admin = user?.role === 'ADMIN';
  const [search, setSearch] = useState(''), query = useDebounced(search.trim());
  const [paging, setPaging] = useState({page:1,limit:20});
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<Product | null>();
  const [unitEditing, setUnitEditing] = useState<ProductUnit | null>();
  const [form] = Form.useForm<ProductCreate>(), [unitForm] = Form.useForm<UnitCreate>();
  const mutation = useMutation();
  const list = useResource(useCallback(signal => api.listProducts({...paging,...(query?{q:query}:{})},{signal}), [paging,query]));
  const detail = useResource(useCallback(signal => selected ? api.getProduct(selected,{signal}) : Promise.resolve(null), [selected]));
  function edit(product: Product | null) { form.resetFields(); form.setFieldsValue(product ?? {is_active:true}); setEditing(product); }
  function editUnit(unit: ProductUnit | null) { unitForm.resetFields(); unitForm.setFieldsValue(unit ?? {conversion_factor:1,is_base_unit:false}); setUnitEditing(unit); }
  async function save(values: ProductCreate) {
    if (editing) {
      const patch: ProductPatch = {};
      if (values.product_name !== editing.product_name) patch.product_name = values.product_name;
      if (values.base_unit !== editing.base_unit) patch.base_unit = values.base_unit;
      if (!Object.keys(patch).length) { message.info('Không có thay đổi.'); setEditing(undefined); return; }
      await mutation.run(()=>api.updateProduct(editing.product_id,patch),'Đã cập nhật sản phẩm.',()=>{setEditing(undefined);list.reload();detail.reload();});
    } else await mutation.run(()=>api.createProduct({product_id:values.product_id,product_name:values.product_name,base_unit:values.base_unit,is_active:values.is_active ?? true}),
      'Đã tạo sản phẩm và bản ghi tồn kho.',()=>{setEditing(undefined);list.reload();});
  }
  async function saveUnit(values: UnitCreate) {
    if (!selected) return;
    await mutation.run(()=>unitEditing ? api.updateProductUnit(unitEditing.product_unit_id,{unit_name:values.unit_name})
      : api.addProductUnit(selected,{unit_name:values.unit_name,scan_code:values.scan_code,conversion_factor:values.conversion_factor,is_base_unit:values.is_base_unit ?? false}),
    unitEditing?'Đã đổi tên đơn vị.':'Đã thêm đơn vị sản phẩm.',()=>{setUnitEditing(undefined);detail.reload();});
  }
  return <div className="page-enter"><PageHeading eyebrow="DANH MỤC" title="Sản phẩm & đơn vị" description="Quản lý văn phòng phẩm, đơn vị quy đổi và mã quét trong một danh mục." action={<Space><RefreshButton onClick={list.reload} loading={list.loading}/>{admin&&<Button type="primary" icon={<PlusOutlined aria-hidden/>} onClick={()=>edit(null)}>Thêm sản phẩm</Button>}</Space>}/>
    <Card className="content-card"><div className="table-toolbar"><Input aria-label="Tìm sản phẩm" prefix={<SearchOutlined/>} placeholder="Tìm mã hoặc tên sản phẩm…" allowClear maxLength={150} value={search} onChange={event=>{setSearch(event.target.value);setPaging(p=>({...p,page:1}));}}/><span className="muted">Danh mục và trạng thái từ hệ thống kho</span></div>
      <ErrorNotice error={list.error} retry={list.reload}/><DataTable<Product> rowKey="product_id" page={list.data} loading={list.loading} onPage={(page,limit)=>setPaging({page,limit})} columns={[
        {title:'Mã sản phẩm',dataIndex:'product_id',render:(value:string)=><Button type="link" className="table-link" onClick={()=>setSelected(value)}>{value}</Button>},
        {title:'Tên sản phẩm',dataIndex:'product_name',render:(value:string)=><strong>{value}</strong>},
        {title:'Đơn vị cơ sở',dataIndex:'base_unit'}, {title:'Trạng thái',dataIndex:'is_active',render:(value:boolean)=><ActiveTag active={value}/>},
        {title:'Ngày tạo (UTC+7)',dataIndex:'created_at',render:timestamp},
        {title:'Thao tác',key:'actions',render:(_,row)=><Space><Button size="small" onClick={()=>setSelected(row.product_id)}>Chi tiết</Button>{admin&&<><Button size="small" icon={<EditOutlined aria-hidden/>} onClick={()=>edit(row)}>Sửa</Button><Popconfirm title={row.is_active?'Ngừng hoạt động sản phẩm?':'Mở lại sản phẩm?'} description="Lịch sử giao dịch được giữ nguyên." onConfirm={()=>mutation.run(()=>api.setProductStatus(row.product_id,!row.is_active),'Đã thay đổi trạng thái.',()=>{list.reload();detail.reload();})}><Button size="small" disabled={mutation.busy} danger={row.is_active}>{row.is_active?'Vô hiệu hóa':'Mở lại'}</Button></Popconfirm></>}</Space>},
      ]}/></Card>
    <Drawer open={!!selected} onClose={()=>setSelected(undefined)} title="Chi tiết sản phẩm" size={760} destroyOnHidden>
      <ErrorNotice error={detail.error} retry={detail.reload}/>{detail.data&&<><Descriptions column={1} bordered items={[
        {key:'id',label:'Mã sản phẩm',children:<IdText value={detail.data.data.product_id}/>},{key:'name',label:'Tên sản phẩm',children:detail.data.data.product_name},
        {key:'base',label:'Đơn vị cơ sở',children:detail.data.data.base_unit},{key:'status',label:'Trạng thái',children:<ActiveTag active={detail.data.data.is_active}/>},
      ]}/><div className="drawer-section"><PanelTitle title="Đơn vị & mã quét" description="Giữ nguyên ý nghĩa đơn vị đã tạo để bảo toàn lịch sử." extra={admin&&<Button type="primary" icon={<PlusOutlined aria-hidden/>} onClick={()=>editUnit(null)}>Thêm đơn vị</Button>}/>
        <Table<ProductUnit> rowKey="product_unit_id" dataSource={detail.data.data.units} pagination={false} scroll={{x:'max-content'}} columns={[
          {title:'Đơn vị',dataIndex:'unit_name'}, {title:'Quy đổi',dataIndex:'conversion_factor',render:(value:number)=>`${value.toLocaleString('vi-VN')} ${detail.data?.data.base_unit ?? ''}`},
          {title:'Mã quét',dataIndex:'scan_code',render:(value:string)=><IdText value={value}/>}, {title:'Cơ sở',dataIndex:'is_base_unit',render:(value:boolean)=>value?'Có':'—'},
          ...(admin?[{title:'Thao tác',key:'edit',render:(_:unknown,row:ProductUnit)=><Button size="small" onClick={()=>editUnit(row)}>Đổi tên</Button>}]:[]),
        ]}/></div></>}{detail.loading&&<Card loading/>}
    </Drawer>
    <Modal open={editing!==undefined} title={editing?'Sửa sản phẩm':'Thêm sản phẩm'} onCancel={()=>{if(!mutation.busy)setEditing(undefined);}} footer={null} forceRender>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={values=>{void save(values);}} clearOnDestroy>
        <Form.Item name="product_id" label="Mã sản phẩm" rules={textRules(20)}><Input maxLength={20} disabled={!!editing} autoFocus/></Form.Item>
        <Form.Item name="product_name" label="Tên sản phẩm" rules={textRules(150)}><Input maxLength={150}/></Form.Item>
        <Form.Item name="base_unit" label="Đơn vị cơ sở" rules={textRules(30)} extra={editing?'Chỉ đổi khi chưa có đơn vị, lịch sử hoặc tồn khác 0.':'Ví dụ: cây, quyển, tờ — không phải số lượng.'}><Input maxLength={30}/></Form.Item>
        {!editing&&<Form.Item name="is_active" valuePropName="checked"><Checkbox>Hoạt động ngay</Checkbox></Form.Item>}
        <div className="modal-actions"><Button disabled={mutation.busy} onClick={()=>setEditing(undefined)}>Hủy</Button><Button aria-label="Lưu sản phẩm" type="primary" htmlType="submit" loading={mutation.busy}>Lưu sản phẩm</Button></div>
      </Form>
    </Modal>
    <Modal zIndex={1500} open={unitEditing!==undefined} title={unitEditing?'Đổi tên đơn vị':'Thêm đơn vị sản phẩm'} onCancel={()=>{if(!mutation.busy)setUnitEditing(undefined);}} footer={null} forceRender>
      <Alert type="info" showIcon title="Mã quét và hệ số quy đổi của đơn vị đã tạo không thể thay đổi." className="form-alert"/>
      <Form form={unitForm} layout="vertical" requiredMark={false} onFinish={values=>{void saveUnit(values);}} clearOnDestroy>
        <Form.Item name="unit_name" label="Tên đơn vị" rules={textRules(30)}><Input maxLength={30} autoFocus/></Form.Item>
        <Form.Item name="scan_code" label="Mã quét" rules={textRules(80)}><Input maxLength={80} disabled={!!unitEditing}/></Form.Item>
        <Form.Item name="conversion_factor" label="Hệ số quy đổi" rules={[{required:true,message:'Nhập hệ số quy đổi.'},{type:'integer',min:1,max:2147483647,message:'Hệ số phải là số nguyên dương hợp lệ.'}]}><InputNumber min={1} max={2147483647} precision={0} disabled={!!unitEditing} style={{width:'100%'}}/></Form.Item>
        <Form.Item name="is_base_unit" valuePropName="checked"><Checkbox disabled={!!unitEditing}>Đơn vị cơ sở (hệ số phải là 1)</Checkbox></Form.Item>
        <div className="modal-actions"><Button disabled={mutation.busy} onClick={()=>setUnitEditing(undefined)}>Hủy</Button><Button aria-label="Lưu đơn vị" type="primary" htmlType="submit" loading={mutation.busy}>Lưu đơn vị</Button></div>
      </Form>
    </Modal>
  </div>;
}
