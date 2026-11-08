import { useCallback, useMemo, useState } from 'react';
import { Button, Card, Descriptions, Drawer, Input, InputNumber, Space, Tabs, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { listDatabaseInventory } from '../lib/api';
import type { Inventory, Page } from '../lib/api';
import { useDebounced, useResource } from '../hooks/useResource';
import { integer, timestamp, validThreshold } from '../lib/format';
import { ActiveTag, DataTable, ErrorNotice, ExactNumber, IdText, PageHeading, RefreshButton } from '../components/Common';

export default function InventoryPage() {
  const [params,setParams] = useSearchParams();
  const low = params.get('tab') === 'low-stock';
  const [paging,setPaging] = useState({page:1,limit:20});
  const [search,setSearch] = useState(''), query = useDebounced(search.trim());
  const [threshold,setThreshold] = useState('10'), settled = useDebounced(threshold);
  const [selected,setSelected] = useState<string>();
  const valid = validThreshold(settled);
  const resource = useResource(useCallback(signal => listDatabaseInventory({signal}), []));
  const filtered = useMemo(() => {
    const rows = resource.data?.data ?? [];
    if (!low) return rows;
    if (!valid) return [];
    return rows.filter(row => BigInt(row.quantity_base) < BigInt(settled)
      && (!query || `${row.product_id} ${row.product_name}`.toLowerCase().includes(query.toLowerCase())));
  }, [resource.data, low, valid, settled, query]);
  const total = low ? filtered.length : (resource.data?.count ?? 0);
  const page: Page<Inventory> | undefined = resource.data && {
    data: filtered.slice((paging.page - 1) * paging.limit, paging.page * paging.limit),
    count: total,
    pagination: {page: paging.page, limit: paging.limit, total, totalPages: Math.ceil(total / paging.limit)},
  };
  const item = resource.data?.data.find(row => row.product_id === selected);
  return <div className="page-enter"><PageHeading title="Tồn kho" action={<RefreshButton onClick={resource.reload} loading={resource.loading}/>}/>
    <Card className="content-card"><Tabs activeKey={low?'low-stock':'all'} onChange={key=>{setParams(key==='low-stock'?{tab:key}:{});setPaging(p=>({...p,page:1}));}} items={[{key:'all',label:'Toàn bộ tồn kho'},{key:'low-stock',label:'Dưới ngưỡng cảnh báo'}]}/>
      {low?<div className="table-toolbar"><Input aria-label="Tìm tồn thấp" prefix={<SearchOutlined/>} placeholder="Tìm mã hoặc tên sản phẩm…" maxLength={150} allowClear value={search} onChange={e=>{setSearch(e.target.value);setPaging(p=>({...p,page:1}));}}/><Space wrap><span>Ngưỡng tồn</span><InputNumber<string> aria-label="Ngưỡng tồn" stringMode min="0" max="9223372036854775807" value={threshold} status={valid?'':'error'} onChange={value=>{setThreshold(value??'');setPaging(p=>({...p,page:1}));}}/><Tag color="warning">Tồn &lt; ngưỡng</Tag></Space></div>:<div className="table-toolbar"><span className="muted">Không cộng gộp số lượng giữa các đơn vị khác loại.</span><Tag>Đơn vị cơ sở</Tag></div>}
      {low&&!valid&&<p role="alert" className="text-amber">Ngưỡng phải là số nguyên từ 0 đến 9223372036854775807.</p>}
      <ErrorNotice error={resource.error} retry={resource.reload}/><DataTable<Inventory> page={page} rowKey="product_id" loading={resource.loading} onPage={(page,limit)=>setPaging({page,limit})} columns={[
        {title:'Mã sản phẩm',dataIndex:'product_id',render:(value:string)=><Button type="link" className="table-link" onClick={()=>setSelected(value)}>{value}</Button>},
        {title:'Tên sản phẩm',dataIndex:'product_name',render:(value:string)=><strong>{value}</strong>}, {title:'Đơn vị cơ sở',dataIndex:'base_unit'},
        {title:'Số lượng tồn',dataIndex:'quantity_base',align:'right',render:(value:string)=><span className={BigInt(value)<10n?'text-amber':'text-green'}><ExactNumber value={value}/></span>},
        {title:'Trạng thái sản phẩm',dataIndex:'is_active',render:(value:boolean)=><ActiveTag active={value}/>},
        {title:'Cập nhật (UTC+7)',dataIndex:'updated_at',render:timestamp}, {title:'Thao tác',key:'actions',render:(_,row)=><Button size="small" onClick={()=>setSelected(row.product_id)}>Chi tiết tồn</Button>},
      ]}/></Card>
    <Drawer title="Chi tiết tồn kho" open={!!selected} onClose={()=>setSelected(undefined)} destroyOnHidden>
      <ErrorNotice error={resource.error} retry={resource.reload}/>{resource.loading?<Card loading/>:item&&<Descriptions bordered column={1} items={[
        {key:'id',label:'Mã sản phẩm',children:<IdText value={item.product_id}/>}, {key:'name',label:'Tên sản phẩm',children:item.product_name},
        {key:'quantity',label:'Số lượng tồn',children:integer(item.quantity_base)}, {key:'base',label:'Đơn vị cơ sở',children:item.base_unit},
        {key:'time',label:'Cập nhật (UTC+7)',children:timestamp(item.updated_at)},
      ]}/>}
    </Drawer>
  </div>;
}
