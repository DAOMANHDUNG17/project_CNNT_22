import { useCallback, useState } from 'react';
import { Alert, App, Avatar, Button, Card, Checkbox, Form, Input, Modal, Popconfirm, Select, Space, Tag } from 'antd';
import { PlusOutlined, SearchOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { api } from '../lib/api';
import type { Role, User, UserCreate, UserPatch } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useDebounced, useMutation, useResource } from '../hooks/useResource';
import { passwordRules, roleLabels, roleOptions, textRules, timestamp } from '../lib/format';
import { ActiveTag, DataTable, ErrorNotice, PageHeading, RefreshButton } from '../components/Common';

export default function UsersPage(){
  const { user:principal,refresh }=useAuth(), {message}=App.useApp();
  const [paging,setPaging]=useState({page:1,limit:20});
  const [search,setSearch]=useState(''), q=useDebounced(search.trim());
  const [role,setRole]=useState<Role>(), [active,setActive]=useState<boolean>();
  const [editing,setEditing]=useState<User|null>(),[reset,setReset]=useState<User>();
  const [form]=Form.useForm<UserCreate>(), [passwordForm]=Form.useForm<{password:string}>();
  const mutation=useMutation();
  const resource=useResource(useCallback(signal=>api.listUsers({...paging,...(q?{q}:{}),role,isActive:active},{signal}),[paging,q,role,active]));
  const resetPage=()=>setPaging(p=>({...p,page:1}));
  function edit(user:User|null){form.resetFields();form.setFieldsValue(user??{role:'STAFF',is_active:true});setEditing(user);}
  async function afterSelf(id:string){resource.reload();if(id===principal?.user_id)await refresh();}
  async function save(values:UserCreate){
    if(editing){
      const patch:UserPatch={};
      if(values.username!==editing.username)patch.username=values.username;
      if(values.display_name!==editing.display_name)patch.display_name=values.display_name;
      if(values.role!==editing.role)patch.role=values.role;
      if(!Object.keys(patch).length){message.info('Không có thay đổi.');setEditing(undefined);return;}
      await mutation.run(()=>api.updateUser(editing.user_id,patch),'Đã cập nhật người dùng.',async()=>{setEditing(undefined);await afterSelf(editing.user_id);});
    }else await mutation.run(()=>api.createUser({username:values.username,display_name:values.display_name,role:values.role,password:values.password,is_active:values.is_active??true}),
      'Đã tạo người dùng.',()=>{form.resetFields();setEditing(undefined);resource.reload();});
  }
  return <div className="page-enter"><PageHeading eyebrow="QUẢN TRỊ HỆ THỐNG" title="Người dùng" description="Quản lý tài khoản, phân quyền và quyền truy cập vào kho văn phòng phẩm." action={<Space><RefreshButton onClick={resource.reload} loading={resource.loading}/><Button type="primary" icon={<PlusOutlined aria-hidden/>} onClick={()=>edit(null)}>Thêm người dùng</Button></Space>}/>
    <Alert className="role-banner" type="info" showIcon icon={<SafetyCertificateOutlined/>} title="Quyền quản trị đi cùng trách nhiệm" description="Thay đổi quyền, trạng thái hoặc mật khẩu sẽ thu hồi hiệu lực các phiên hiện có của người dùng. Hệ thống luôn giữ ít nhất một ADMIN hoạt động."/>
    <Card className="content-card"><div className="table-toolbar"><Input aria-label="Tìm người dùng" prefix={<SearchOutlined/>} placeholder="Tìm tài khoản hoặc tên hiển thị…" maxLength={150} allowClear value={search} onChange={e=>{setSearch(e.target.value);resetPage();}}/><Space wrap>
      <Select aria-label="Lọc vai trò" placeholder="Mọi vai trò" style={{minWidth:170}} allowClear value={role} options={roleOptions} onChange={value=>{setRole(value);resetPage();}}/>
      <Select aria-label="Lọc trạng thái" placeholder="Mọi trạng thái" style={{minWidth:170}} allowClear value={active} options={[{value:true,label:'Đang hoạt động'},{value:false,label:'Đã khóa'}]} onChange={value=>{setActive(value);resetPage();}}/>
    </Space></div><ErrorNotice error={resource.error} retry={resource.reload}/><DataTable<User> rowKey="user_id" page={resource.data} loading={resource.loading} onPage={(page,limit)=>setPaging({page,limit})} columns={[
      {title:'Người dùng',dataIndex:'display_name',render:(value:string,row)=><Space><Avatar style={{background:'#e4efe9',color:'#21715a'}}>{value.slice(0,1)}</Avatar><div className="cell-product"><strong>{value}{row.user_id===principal?.user_id&&<Tag className="self-tag">Bạn</Tag>}</strong><small>{row.username}</small></div></Space>},
      {title:'Vai trò',dataIndex:'role',render:(value:Role)=><Tag color={value==='ADMIN'?'geekblue':value==='KEEPER'?'cyan':'default'}>{roleLabels[value]}</Tag>},
      {title:'Trạng thái',dataIndex:'is_active',render:(value:boolean)=><ActiveTag active={value}/>}, {title:'Ngày tạo (UTC+7)',dataIndex:'created_at',render:timestamp},
      {title:'Thao tác',key:'actions',render:(_,row)=><Space wrap><Button size="small" onClick={()=>edit(row)}>Sửa người dùng</Button><Popconfirm title={row.is_active?'Khóa tài khoản?':'Mở khóa tài khoản?'} description="Phiên hiện có sẽ bị thu hồi." onConfirm={()=>mutation.run(()=>api.setUserStatus(row.user_id,!row.is_active),'Đã cập nhật trạng thái.',()=>afterSelf(row.user_id))}><Button size="small" danger={row.is_active} disabled={mutation.busy}>{row.is_active?'Khóa':'Mở khóa'}</Button></Popconfirm><Button size="small" onClick={()=>{passwordForm.resetFields();setReset(row);}}>Đặt lại mật khẩu</Button></Space>},
    ]}/></Card>
    <Modal title={editing?'Sửa người dùng':'Thêm người dùng'} open={editing!==undefined} forceRender footer={null} onCancel={()=>{if(!mutation.busy){form.resetFields();setEditing(undefined);}}}>
      <Form form={form} layout="vertical" requiredMark={false} clearOnDestroy onFinish={values=>{void save(values);}}>
        <Form.Item label="Tên đăng nhập" name="username" rules={textRules(50)}><Input maxLength={50} autoComplete="off" autoFocus/></Form.Item>
        <Form.Item label="Tên hiển thị" name="display_name" rules={textRules(120)}><Input maxLength={120}/></Form.Item>
        <Form.Item label="Vai trò" name="role" rules={[{required:true,message:'Chọn vai trò.'}]}><Select options={roleOptions}/></Form.Item>
        {!editing&&<><Form.Item label="Mật khẩu ban đầu" name="password" rules={passwordRules} extra="12–128 ký tự. Không gửi mật khẩu qua kênh công khai."><Input.Password autoComplete="new-password" maxLength={128}/></Form.Item><Form.Item name="is_active" valuePropName="checked"><Checkbox>Cho phép hoạt động ngay</Checkbox></Form.Item></>}
        <div className="modal-actions"><Button disabled={mutation.busy} onClick={()=>{form.resetFields();setEditing(undefined);}}>Hủy</Button><Button aria-label="Lưu người dùng" type="primary" htmlType="submit" loading={mutation.busy}>Lưu người dùng</Button></div>
      </Form>
    </Modal>
    <Modal title={`Đặt lại mật khẩu · ${reset?.username??''}`} open={!!reset} forceRender footer={null} onCancel={()=>{if(!mutation.busy){passwordForm.resetFields();setReset(undefined);}}}>
      <Alert className="form-alert" type="warning" showIcon title="Tất cả phiên đăng nhập hiện có của tài khoản này sẽ mất hiệu lực."/>
      <Form form={passwordForm} layout="vertical" requiredMark={false} clearOnDestroy onFinish={({password})=>{if(reset)void mutation.run(()=>api.resetUserPassword(reset.user_id,password),'Đã đặt lại mật khẩu.',async()=>{passwordForm.resetFields();setReset(undefined);await afterSelf(reset.user_id);});}}>
        <Form.Item label="Mật khẩu mới" name="password" rules={passwordRules}><Input.Password autoFocus autoComplete="new-password" maxLength={128}/></Form.Item>
        <div className="modal-actions"><Button disabled={mutation.busy} onClick={()=>{passwordForm.resetFields();setReset(undefined);}}>Hủy</Button><Button aria-label="Xác nhận đặt lại" type="primary" htmlType="submit" loading={mutation.busy}>Xác nhận đặt lại</Button></div>
      </Form>
    </Modal>
  </div>;
}
