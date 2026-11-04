import { useCallback, useState } from 'react';
import { Button, Card, Descriptions, Drawer, Input, Select, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { api, allPages } from '../lib/api';
import type { ScanPoint, Transaction } from '../lib/api';
import { useDebounced, useResource } from '../hooks/useResource';
import { integer, timestamp } from '../lib/format';
import { DataTable, ErrorNotice, IdText, MovementTag, PageHeading, RefreshButton } from '../components/Common';

export default function TransactionsPage() {
  const [paging,setPaging] = useState({page:1,limit:20});
  const [product,setProduct] = useState(''), productId = useDebounced(product.trim());
  const [movementType,setMovementType] = useState<'IN'|'OUT'>();
  const [scanPointId,setScanPointId] = useState<string>();
  const [selected,setSelected] = useState<string>();
  const points = useResource(useCallback(signal=>allPages<ScanPoint>(page=>api.listScanPoints({page,limit:100},{signal}),signal),[]));
  const list = useResource(useCallback(signal=>api.listTransactions({...paging,...(productId?{productId}:{}),movementType,scanPointId},{signal}),[paging,productId,movementType,scanPointId]));
  const detail = useResource(useCallback(signal=>selected?api.getTransaction(selected,{signal}):Promise.resolve(null),[selected]));
  const resetPage = ()=>setPaging(p=>({...p,page:1}));
  return <div className="page-enter"><PageHeading title="Giao dịch" action={<RefreshButton onClick={list.reload} loading={list.loading}/>}/>
    <Card className="content-card"><div className="table-toolbar"><Input aria-label="Lọc mã sản phẩm" maxLength={20} prefix={<SearchOutlined/>} placeholder="Lọc theo mã sản phẩm chính xác…" allowClear value={product} onChange={e=>{setProduct(e.target.value);resetPage();}}/>
      <Space wrap><Select aria-label="Loại giao dịch" placeholder="Mọi loại giao dịch" allowClear value={movementType} style={{minWidth:170}} options={[{value:'IN',label:'Nhập kho'},{value:'OUT',label:'Xuất kho'}]} onChange={value=>{setMovementType(value);resetPage();}}/>
        <Select aria-label="Lọc điểm quét" placeholder="Mọi điểm quét" value={scanPointId} loading={points.loading} allowClear style={{minWidth:200}} options={points.data?.map(p=>({value:p.scan_point_id,label:`${p.scan_point_id} · ${p.point_name}`}))} onChange={value=>{setScanPointId(value);resetPage();}}/></Space></div>
      <ErrorNotice error={points.error} retry={points.reload}/><ErrorNotice error={list.error} retry={list.reload}/><DataTable<Transaction> rowKey="transaction_id" page={list.data} loading={list.loading} onPage={(page,limit)=>setPaging({page,limit})} columns={[
        {title:'Thời gian (UTC+7)',dataIndex:'created_at',render:timestamp},
        {title:'Sản phẩm',dataIndex:'product_name',render:(value:string,row)=><div className="cell-product"><strong>{value}</strong><small>{row.product_id}</small></div>},
        {title:'Loại',dataIndex:'movement_type',render:(value:'IN'|'OUT')=><MovementTag type={value}/>},
        {title:'Số gói',dataIndex:'quantity_packages',align:'right',render:(value:number,row)=>`${value.toLocaleString('vi-VN')} ${row.unit_name}`},
        {title:'Số lượng cơ sở',dataIndex:'quantity_base',align:'right',render:integer}, {title:'Tồn sau giao dịch',dataIndex:'inventory_after',align:'right',render:integer},
        {title:'Điểm quét',dataIndex:'point_name',render:(value:string,row)=><div className="cell-product"><span>{value}</span><small>{row.scan_point_id}</small></div>},
        {title:'Thao tác',key:'actions',render:(_,row)=><Button size="small" onClick={()=>setSelected(row.transaction_id)}>Chi tiết</Button>},
      ]}/></Card>
    <Drawer title="Chi tiết giao dịch" open={!!selected} onClose={()=>setSelected(undefined)} size={620} destroyOnHidden><ErrorNotice error={detail.error} retry={detail.reload}/>{detail.loading?<Card loading/>:detail.data&&<>
      <p className="muted">Số lượng và hệ số là snapshot đã lưu. Tồn sau giao dịch có thể khác tồn hiện tại.</p><Descriptions bordered column={1} items={[
        {key:'id',label:'Mã giao dịch',children:<IdText value={detail.data.data.transaction_id}/>},
        {key:'product',label:'Sản phẩm',children:`${detail.data.data.product_id} · ${detail.data.data.product_name}`},
        {key:'type',label:'Loại',children:<MovementTag type={detail.data.data.movement_type}/>},
        {key:'packages',label:'Số gói',children:`${detail.data.data.quantity_packages} ${detail.data.data.unit_name}`},
        {key:'factor',label:'Hệ số tại thời điểm ghi',children:detail.data.data.conversion_factor_snapshot.toLocaleString('vi-VN')},
        {key:'quantity',label:'Số lượng cơ sở',children:integer(detail.data.data.quantity_base)},
        {key:'after',label:'Tồn sau giao dịch',children:integer(detail.data.data.inventory_after)},
        {key:'point',label:'Điểm quét',children:`${detail.data.data.scan_point_id} · ${detail.data.data.point_name}`},
        {key:'time',label:'Thời gian (UTC+7)',children:timestamp(detail.data.data.created_at)},
      ]}/></>}
    </Drawer>
  </div>;
}
