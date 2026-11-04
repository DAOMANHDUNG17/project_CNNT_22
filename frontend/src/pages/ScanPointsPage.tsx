import { useCallback, useState } from 'react';
import { Button, Card, Checkbox, Form, Input, Modal, Space, Typography } from 'antd';
import { EnvironmentOutlined, PlusOutlined, ScanOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { ScanPoint, ScanPointCreate } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useMutation, useResource } from '../hooks/useResource';
import { textRules } from '../lib/format';
import { ActiveTag, DataTable, ErrorNotice, PageHeading, RefreshButton } from '../components/Common';

export default function ScanPointsPage() {
  const { user } = useAuth(), admin=user?.role==='ADMIN';
  const [paging,setPaging]=useState({page:1,limit:20});
  const [editing,setEditing]=useState<ScanPoint|null>();
  const [form]=Form.useForm<ScanPointCreate>();
  const mutation=useMutation();
  const resource=useResource(useCallback(signal=>api.listScanPoints(paging,{signal}),[paging]));
  function edit(point:ScanPoint|null){form.resetFields();form.setFieldsValue(point??{is_active:true});setEditing(point);}
  async function save(values:ScanPointCreate){
    await mutation.run(()=>editing?api.updateScanPoint(editing.scan_point_id,{point_name:values.point_name,is_active:values.is_active??true})
      :api.createScanPoint({scan_point_id:values.scan_point_id,point_name:values.point_name,is_active:values.is_active??true}),
    editing?'Đã cập nhật điểm quét.':'Đã tạo điểm quét.',()=>{setEditing(undefined);resource.reload();});
  }
  return <div className="page-enter"><PageHeading title="Điểm quét" action={<Space><RefreshButton onClick={resource.reload} loading={resource.loading}/>{admin&&<Button type="primary" icon={<PlusOutlined aria-hidden/>} onClick={()=>edit(null)}>Thêm điểm quét</Button>}</Space>}/>
    <div className="station-banner"><span className="station-banner-icon"><EnvironmentOutlined/></span><div><h2>Mỗi trạm, một luồng công việc</h2><p>Các điểm ghi nhận đã sẵn sàng. Giao diện quét mã và nhập/xuất kho đang chờ An phát triển.</p></div><Tagline/></div>
    <Card className="content-card"><ErrorNotice error={resource.error} retry={resource.reload}/><DataTable<ScanPoint> rowKey="scan_point_id" page={resource.data} loading={resource.loading} onPage={(page,limit)=>setPaging({page,limit})} columns={[
      {title:'Mã điểm quét',dataIndex:'scan_point_id',render:(value:string)=><strong className="id-text">{value}</strong>}, {title:'Tên điểm quét',dataIndex:'point_name'},
      {title:'Trạng thái',dataIndex:'is_active',render:(value:boolean)=><ActiveTag active={value}/>},
      {title:'Đường dẫn trạm',key:'station',render:(_,row)=><Typography.Text copyable={{text:`${window.location.origin}/stock-movement?station=${encodeURIComponent(row.scan_point_id)}`}}>Cấu hình {row.scan_point_id}</Typography.Text>},
      {title:'Thao tác',key:'actions',render:(_,row)=><Space>{user?.role!=='VIEWER'&&row.is_active&&<Link to={`/stock-movement?station=${encodeURIComponent(row.scan_point_id)}`}><Button size="small" icon={<ScanOutlined aria-hidden/>}>Trang module</Button></Link>}{admin&&<Button size="small" onClick={()=>edit(row)}>Sửa điểm quét</Button>}</Space>},
    ]}/></Card>
    <Modal open={editing!==undefined} title={editing?'Sửa điểm quét':'Thêm điểm quét'} footer={null} forceRender onCancel={()=>{if(!mutation.busy)setEditing(undefined);}}>
      <Form form={form} layout="vertical" requiredMark={false} clearOnDestroy onFinish={values=>{void save(values);}}>
        <Form.Item name="scan_point_id" label="Mã điểm quét" rules={textRules(20)} extra="Ví dụ: SCAN01, SCAN02. Mã đã tạo không thể đổi."><Input maxLength={20} disabled={!!editing} autoFocus/></Form.Item>
        <Form.Item name="point_name" label="Tên điểm quét" rules={textRules(100)}><Input maxLength={100}/></Form.Item>
        <Form.Item name="is_active" valuePropName="checked"><Checkbox>Đang hoạt động</Checkbox></Form.Item>
        <div className="modal-actions"><Button disabled={mutation.busy} onClick={()=>setEditing(undefined)}>Hủy</Button><Button aria-label="Lưu điểm quét" loading={mutation.busy} type="primary" htmlType="submit">Lưu điểm quét</Button></div>
      </Form>
    </Modal>
  </div>;
}
function Tagline(){return <div className="station-banner-meta">TÀI KHOẢN CÓ QUYỀN<br/><strong>Thao tác được kiểm soát</strong></div>;}
