import { useCallback, useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Row, Select, Skeleton, Space, Table, Tag } from 'antd';
import { AppstoreOutlined, ArrowDownOutlined, ArrowRightOutlined, ArrowUpOutlined, HistoryOutlined, ScanOutlined, WarningOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { api, allPages } from '../lib/api';
import type { Trend } from '../lib/api';
import { useResource } from '../hooks/useResource';
import { useAuth } from '../auth/AuthProvider';
import { integer, timestamp } from '../lib/format';
import { DataTable, ErrorNotice, ExactNumber, MovementTag, PageHeading, PanelTitle, RefreshButton } from '../components/Common';
import { TrendChart } from '../components/TrendChart';

const utcToday = () => new Date().toISOString().slice(0,10);
export default function DashboardPage() {
  const { user } = useAuth();
  const [range, setRange] = useState({ from: dayjs(utcToday()).subtract(29,'day').format('YYYY-MM-DD'), to: utcToday() });
  const [granularity, setGranularity] = useState<'day'|'month'>('day');
  const [topPage, setTopPage] = useState({ page: 1, limit: 5 });
  const summary = useResource(useCallback(signal => api.summary('10', { signal }), []));
  const trends = useResource(useCallback(signal => allPages<Trend>(page => api.stockTrends({ ...range, granularity, page, limit: 100 }, { signal }), signal), [range, granularity]));
  const top = useResource(useCallback(signal => api.topProducts({ ...range, ...topPage }, { signal }), [range, topPage]));
  const latest = useResource(useCallback(signal => api.listTransactions({ limit: 5 }, { signal }), []));
  const low = useResource(useCallback(signal => api.lowStock({ threshold: '10', limit: 5 }, { signal }), []));
  const data = summary.data?.data;
  const reload = () => { summary.reload(); trends.reload(); top.reload(); latest.reload(); low.reload(); };
  return <div className="page-enter">
    <PageHeading title={`Chào ${user?.display_name ?? 'bạn'},`} action={<Space wrap><RefreshButton onClick={reload} loading={summary.loading} />{user?.role !== 'VIEWER' && <Link to="/stock-movement"><Button type="primary" icon={<ScanOutlined />}>Module nhập / xuất</Button></Link>}</Space>} />
    <ErrorNotice error={summary.error} retry={summary.reload} />
    <Row gutter={[18,18]} className="stat-grid">{[
      { label: 'Sản phẩm trong danh mục', value: data?.products.total, sub: data ? `${integer(data.products.active)} đang hoạt động` : 'Danh mục sản phẩm', icon: <AppstoreOutlined />, className: 'green', link: '/products' },
      { label: 'Giao dịch đã ghi nhận', value: data?.transactions.total, sub: data ? `${integer(data.transactions.IN)} nhập · ${integer(data.transactions.OUT)} xuất` : 'Toàn bộ lịch sử', icon: <HistoryOutlined />, className: 'blue', link: '/transactions' },
      { label: 'Sản phẩm dưới ngưỡng', value: data?.low_stock.product_count, sub: 'Tồn < 10 đơn vị cơ sở / sản phẩm', icon: <WarningOutlined />, className: 'amber', link: '/inventory?tab=low-stock' },
    ].map(stat => <Col xs={24} md={8} key={stat.label}><Card className={`stat-card ${stat.className}`}><div className="stat-top"><span>{stat.label}</span><span className="stat-icon">{stat.icon}</span></div>{summary.loading ? <Skeleton.Input active size="small" /> : <div className="stat-value">{stat.value === undefined ? '—' : integer(stat.value)}</div>}<div className="stat-bottom"><span>{stat.sub}</span><Link to={stat.link} aria-label={`Xem ${stat.label}`}><ArrowUpOutlined rotate={45} /></Link></div></Card></Col>)}</Row>
    <section className="unit-totals"><PanelTitle title="Tồn kho theo đơn vị" description="Theo từng đơn vị cơ sở · Không cộng gộp các đơn vị khác loại" extra={<Link to="/inventory">Xem tồn kho <ArrowRightOutlined /></Link>} />
      {summary.loading ? <Skeleton active paragraph={{ rows: 1 }} /> : <div className="unit-total-list">{data?.inventory_totals.map(item => <div className="unit-total" key={item.base_unit}><span className="unit-dot" /><div><span className="unit-label">{item.base_unit}</span><ExactNumber value={item.quantity_base} /></div></div>)}{data && data.inventory_totals.length === 0 && <span className="muted">Chưa có bản ghi tồn kho.</span>}</div>}
      {data && data.products.missing_inventory !== '0' && <Alert type="warning" showIcon title={`${integer(data.products.missing_inventory)} sản phẩm chưa có bản ghi tồn kho; không được tính là tồn 0.`} />}
    </section>
    <div className="analytics-grid"><Card className="content-card chart-card"><PanelTitle title="Nhịp hoạt động kho" description="Số lượt giao dịch nhập và xuất — không cộng số lượng của các đơn vị khác nhau" extra={<><Select aria-label="Nhóm biểu đồ" value={granularity} onChange={setGranularity} options={[{value:'day',label:'Theo ngày'},{value:'month',label:'Theo tháng'}]} /><DatePicker.RangePicker allowClear={false} value={[dayjs(range.from),dayjs(range.to)]} format="DD/MM/YYYY" onChange={values => { if(values?.[0] && values[1]) { setRange({from: values[0].format('YYYY-MM-DD'),to: values[1].format('YYYY-MM-DD')}); setTopPage(p=>({...p,page:1})); } }} disabledDate={current => current.isBefore('0001-01-01')} /></>} />
      <ErrorNotice error={trends.error} retry={trends.reload} />{trends.loading ? <Skeleton active paragraph={{rows:5}} /> : <TrendChart rows={trends.data ?? []} />}
      <details className="chart-details"><summary>Xem bảng số liệu chính xác · UTC</summary><Table<Trend> rowKey="period_start" size="small" scroll={{x:'max-content'}} pagination={{pageSize:10}} dataSource={trends.data ?? []} columns={[
        {title:'Kỳ UTC',dataIndex:'period_start',render:(value:string)=>value.slice(0,10)}, {title:'Lượt nhập',dataIndex:'in_count',render:integer}, {title:'Lượt xuất',dataIndex:'out_count',render:integer}, {title:'Tổng lượt',dataIndex:'total_count',render:integer},
      ]}/></details>
    </Card><Card className="content-card"><PanelTitle title="Sản phẩm hoạt động nhiều" description="Xếp hạng theo số lượt trong khoảng thời gian đã chọn" extra={<Tag>Theo giao dịch</Tag>} />
      <ErrorNotice error={top.error} retry={top.reload} /><DataTable rowKey="product_id" page={top.data} loading={top.loading} onPage={(page,limit)=>setTopPage({page,limit})} columns={[
        {title:'Sản phẩm',dataIndex:'product_name',render:(value:string,row)=><div className="cell-product"><strong>{value}</strong><small>{row.product_id} · {row.base_unit}</small></div>},
        {title:'Giao dịch',dataIndex:'transaction_count',align:'right',render:integer},
        {title:'Nhập',dataIndex:'quantity_in_base',align:'right',render:(value:string)=><span className="text-green">{integer(value)}</span>},
        {title:'Xuất',dataIndex:'quantity_out_base',align:'right',render:(value:string)=><span className="text-amber">{integer(value)}</span>},
      ]}/></Card></div>
    <div className="operations-grid"><Card className="content-card"><PanelTitle title="Giao dịch gần đây" description="Những chuyển động mới nhất của kho" extra={<Link to="/transactions">Toàn bộ lịch sử <ArrowRightOutlined /></Link>} /><ErrorNotice error={latest.error} retry={latest.reload}/>
      <Table rowKey="transaction_id" loading={latest.loading} dataSource={latest.data?.data ?? []} pagination={false} scroll={{x:'max-content'}} columns={[
        {title:'Thời gian (UTC+7)',dataIndex:'created_at',render:timestamp}, {title:'Sản phẩm',dataIndex:'product_name'},
        {title:'Loại',dataIndex:'movement_type',render:(value:'IN'|'OUT')=><MovementTag type={value}/>},
        {title:'Số lượng gói',dataIndex:'quantity_packages',render:(value:number,row)=><span>{row.movement_type==='IN'?<ArrowDownOutlined className="text-green"/>:<ArrowUpOutlined className="text-amber"/>} {value} {row.unit_name}</span>},
        {title:'Điểm quét',dataIndex:'point_name'},
      ]}/></Card><Card className="content-card"><PanelTitle title="Cần lưu ý" description="Sản phẩm có tồn dưới 10 đơn vị cơ sở" extra={<Link to="/inventory?tab=low-stock">Xem tất cả <ArrowRightOutlined /></Link>} />
      <ErrorNotice error={low.error} retry={low.reload}/><Table rowKey="product_id" loading={low.loading} pagination={false} dataSource={low.data?.data ?? []} scroll={{x:'max-content'}} columns={[
        {title:'Sản phẩm',dataIndex:'product_name',render:(value:string,row)=><div className="cell-product"><strong>{value}</strong><small>{row.product_id}</small></div>},
        {title:'Còn lại',dataIndex:'quantity_base',align:'right',render:(value:string,row)=><Tag color="warning">{integer(value)} {row.base_unit}</Tag>},
      ]}/><Link className="panel-bottom-link" to="/inventory">Kiểm tra tồn kho <ArrowRightOutlined /></Link></Card></div>
  </div>;
}
