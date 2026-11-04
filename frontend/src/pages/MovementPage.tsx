import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Col, Descriptions, Form, Input, InputNumber, Result, Row, Segmented, Select, Space, Steps, Tag } from 'antd';
import { ArrowDownOutlined, ArrowRightOutlined, ArrowUpOutlined, CheckCircleOutlined, EnvironmentOutlined, ReloadOutlined, ScanOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { api, allPages, ApiError, movementDeadline, OutcomeUnknownError } from '../lib/api';
import type { MovementRequest, MovementResponse, ScanPoint } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useResource } from '../hooks/useResource';
import { errorMessage, integer, textRules } from '../lib/format';
import { loadPending, savePending } from '../lib/pendingMovement';
import type { PendingMovement } from '../lib/pendingMovement';
import { ErrorNotice, IdText, MovementTag, PageHeading, PanelTitle } from '../components/Common';

type FormValues = Omit<MovementRequest,'transaction_id'|'movement_type'>;
export default function MovementPage() {
  const { user, refresh } = useAuth(), { message } = App.useApp();
  const userId = user?.user_id ?? '';
  const [params] = useSearchParams();
  const [form] = Form.useForm<FormValues>();
  const [pending,setPending] = useState<PendingMovement | null>(()=>loadPending(userId));
  const [movement,setMovement] = useState<'IN'|'OUT'>(()=>pending?.payload.movement_type ?? (user?.role==='STAFF'?'OUT':'IN'));
  const [busy,setBusy] = useState(false), [error,setError] = useState<unknown>();
  const [result,setResult] = useState<MovementResponse>();
  const [storageError,setStorageError] = useState(false);
  const gate = useRef(false);
  const points = useResource(useCallback(signal=>allPages<ScanPoint>(page=>api.listScanPoints({page,limit:100},{signal}),signal),[]));
  const station = params.get('station');
  const activePoints = points.data?.filter(point=>point.is_active) ?? [];
  useEffect(()=>{
    if(pending) form.setFieldsValue(pending.payload);
    else if(station && activePoints.some(point=>point.scan_point_id===station)) form.setFieldValue('scan_point_id',station);
  // Only apply station configuration after the API options arrive.
  },[pending,station,points.data,form]);
  useEffect(()=>{
    if(!pending||result)return;
    const warn = (event: BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[pending,result]);
  async function send(action: PendingMovement) {
    if(gate.current)return;
    gate.current=true;setBusy(true);setError(undefined);setResult(undefined);
    try { const response=await movementDeadline(api.recordTransaction(action.payload));setResult(response);message.success(response.meta.result_status==='DUPLICATE'?'Giao dịch đã được ghi trước đó, không ghi thêm.':'Đã ghi nhận giao dịch.'); }
    catch(failure){setError(failure);}
    finally{gate.current=false;setBusy(false);}
  }
  function submit(values: FormValues) {
    if(pending||gate.current)return;
    const action:PendingMovement={createdAt:new Date().toISOString(),payload:{transaction_id:crypto.randomUUID(),
      scan_point_id:values.scan_point_id,scan_code:values.scan_code,movement_type:movement,quantity_packages:values.quantity_packages}};
    // Store the immutable action before starting HTTP. Only business data is
    // persisted per tab/user; never cookie, CSRF, password or authentication.
    try{savePending(userId,action);}catch{setStorageError(true);return;}
    setPending(action);void send(action);
  }
  const uncertain = !!pending && !result && (!error || error instanceof OutcomeUnknownError || !(error instanceof ApiError) || error.status>=500);
  const conflict = error instanceof ApiError && ['IDEMPOTENCY_CONFLICT','IDEMPOTENCY_LEGACY_RECORD'].includes(error.code);
  const canReplace = !!result || (error instanceof ApiError && [400,403,409,422].includes(error.status) && !conflict);
  function fresh() {
    try{savePending(userId,null);}catch{setStorageError(true);return;}
    setPending(null);setResult(undefined);setError(undefined);setStorageError(false);
    form.setFieldsValue({scan_code:'',quantity_packages:1});
  }
  const selectedPoint = Form.useWatch('scan_point_id',form) as string | undefined;
  return <div className="page-enter"><PageHeading eyebrow="VẬN HÀNH KHO" title="Nhập / Xuất kho" description="Chọn điểm ghi nhận, quét mã đơn vị và xác nhận số lượng. Mỗi thao tác được lưu một lần."/>
    <Row gutter={[24,24]}><Col xs={24} xl={15}><Card className="content-card movement-card"><PanelTitle title="Ghi nhận chuyển động" description="Hỗ trợ máy quét mã vạch hoặc nhập mã thủ công" extra={<Tag color="green"><ScanOutlined/> QUÉT & GHI NHẬN</Tag>}/>
      <Segmented block className="movement-toggle" size="large" value={movement} disabled={!!pending||busy} options={[
        {value:'IN',label:<span><ArrowDownOutlined/> Nhập kho</span>,disabled:user?.role==='STAFF'},
        {value:'OUT',label:<span><ArrowUpOutlined/> Xuất kho</span>},
      ]} onChange={value=>{if(value==='IN'||value==='OUT')setMovement(value);}}/>
      <ErrorNotice error={points.error} retry={points.reload}/>
      {station&&points.data&&!activePoints.some(p=>p.scan_point_id===station)&&<Alert type="warning" showIcon className="form-alert" title={`Trạm ${station} chưa có hoặc đã ngừng hoạt động. Chọn điểm quét hợp lệ bên dưới.`}/>}
      {storageError&&<Alert type="error" showIcon className="form-alert" title="Không lưu được yêu cầu chờ trong tab này. Bật sessionStorage trước khi ghi giao dịch để có thể khôi phục khi mất phản hồi."/>}
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{quantity_packages:1}} onFinish={submit} disabled={!!pending||busy}>
        <Form.Item label="Điểm quét" name="scan_point_id" rules={[{required:true,message:'Chọn điểm quét.'}]} extra="Điểm ghi nhận nghiệp vụ; lựa chọn này không xác thực thiết bị."><Select aria-label="Điểm quét giao dịch" placeholder="Chọn điểm quét" loading={points.loading} options={activePoints.map(p=>({value:p.scan_point_id,label:`${p.scan_point_id} · ${p.point_name}`}))}/></Form.Item>
        <Form.Item label="Mã quét đơn vị" name="scan_code" rules={textRules(80)}><Input autoFocus size="large" prefix={<ScanOutlined/>} maxLength={80} placeholder="Quét hoặc nhập mã đơn vị sản phẩm" autoComplete="off"/></Form.Item>
        <Form.Item label="Số lượng gói / đơn vị quét" name="quantity_packages" rules={[{required:true,message:'Nhập số lượng.'},{type:'integer',min:1,max:2147483647,message:'Số lượng phải là số nguyên từ 1 đến 2147483647.'}]}><InputNumber aria-label="Số lượng gói" size="large" min={1} max={2147483647} precision={0} style={{width:'100%'}}/></Form.Item>
        {!pending&&<Button type="primary" size="large" block htmlType="submit" loading={busy} icon={<ArrowRightOutlined aria-hidden/>} iconPlacement="end" disabled={points.loading||!!points.error||!activePoints.length}>Xác nhận {movement==='IN'?'nhập kho':'xuất kho'}</Button>}
      </Form>
      {pending&&<div className="pending-actions">{uncertain&&!busy&&<Alert type="warning" showIcon title="Yêu cầu đang chờ xác nhận kết quả" description="Không tạo thao tác mới cho cùng nghiệp vụ. Kiểm tra lại sẽ gửi đúng mã giao dịch và nội dung đang giữ."/>}
        {!!error&&<Alert type={uncertain?'warning':'error'} showIcon title={errorMessage(error)} description={error instanceof ApiError?`Mã lỗi: ${error.code} · HTTP ${error.status}`:undefined}/>}
        {!result&&<Space wrap><Button aria-label="Kiểm tra / Thử lại cùng yêu cầu" type="primary" icon={<ReloadOutlined aria-hidden/>} loading={busy} onClick={()=>{void send(pending);}}>Kiểm tra / Thử lại cùng yêu cầu</Button>{error instanceof ApiError&&error.code==='CSRF_FAILED'&&<Button onClick={()=>{void api.csrf().then(()=>message.success('Đã làm mới token bảo vệ phiên.')).catch(failure=>message.error(errorMessage(failure)));}}>Làm mới token phiên</Button>}</Space>}
        {canReplace&&<Button onClick={fresh} disabled={busy}>{result?'Giao dịch mới':'Sửa thành thao tác mới'}</Button>}
        {conflict&&<p className="muted">Yêu cầu bị xung đột. Giữ lại mã giao dịch và liên hệ quản trị viên để đối chiếu lịch sử.</p>}
      </div>}
      {result&&<Result className="movement-result" icon={<CheckCircleOutlined/>} title={result.meta.result_status==='DUPLICATE'?'Đã xác nhận giao dịch trước đó':'Ghi nhận thành công'} subTitle={result.meta.result_status==='DUPLICATE'?'Không phát sinh thêm lần nhập/xuất.':'Tồn kho và lịch sử đã được cập nhật.'} extra={<Tag color="success">{result.meta.result_status}</Tag>}/>}
    </Card></Col><Col xs={24} xl={9}><Card className="content-card station-card"><span className="eyebrow">ĐIỂM GHI NHẬN</span><EnvironmentOutlined className="station-icon"/><h2>{pending?.payload.scan_point_id ?? selectedPoint ?? 'Chưa chọn trạm'}</h2><p>{points.data?.find(p=>p.scan_point_id===(pending?.payload.scan_point_id??selectedPoint))?.point_name ?? 'Chọn một điểm quét đang hoạt động trong hệ thống.'}</p><div className="station-card-divider"/><Steps direction="vertical" size="small" current={result?2:pending?1:0} items={[{title:'Chọn trạm & quét mã',description:'Xác định đúng đơn vị sản phẩm'},{title:'Xác nhận thao tác',description:'Giữ một mã cho một nghiệp vụ'},{title:'Kiểm tra kết quả',description:'Tồn kho và lịch sử được đồng bộ'}]}/></Card>
      {pending&&<Card className="content-card"><PanelTitle title="Yêu cầu đang giữ"/><MovementTag type={pending.payload.movement_type}/><div className="pending-id"><IdText value={pending.payload.transaction_id}/></div><Descriptions size="small" column={1} items={[
        {key:'scan',label:'Mã quét',children:pending.payload.scan_code},{key:'point',label:'Điểm quét',children:pending.payload.scan_point_id},
        {key:'quantity',label:'Số gói',children:pending.payload.quantity_packages.toLocaleString('vi-VN')},
        ...(result?[{key:'after',label:'Tồn sau giao dịch',children:integer(result.data.inventory_after)},{key:'base',label:'Số lượng cơ sở',children:integer(result.data.quantity_base)}]:[]),
      ]}/><p className="muted small">Yêu cầu được giữ riêng trong tab này. Đăng nhập lại cùng tài khoản có thể tiếp tục kiểm tra.</p></Card>}
      <div className="movement-note"><strong>Mỗi mã quét, một đơn vị</strong><p>Hệ số quy đổi do hệ thống xác định. Nhân viên chỉ có quyền xuất kho; máy chủ kiểm tra lại quyền ở mọi thao tác.</p><Button type="link" onClick={()=>{void refresh();}}>Kiểm tra lại quyền tài khoản</Button></div>
    </Col></Row>
  </div>;
}
