import { Alert, Empty } from 'antd';
import type { Trend } from '../lib/api';
import { chartCount, integer } from '../lib/format';

export function TrendChart({ rows }: { rows: Trend[] }) {
  if (!rows.length) return <Empty description="Chưa có dữ liệu trong khoảng thời gian này" />;
  const points = rows.map(row => ({ in: chartCount(row.in_count), out: chartCount(row.out_count) }));
  if (points.some(row => row.in === null || row.out === null)) return <Alert type="info" showIcon title="Số lượt vượt vùng an toàn của biểu đồ. Xem số liệu chính xác trong bảng bên dưới." />;
  const max = Math.max(1, ...points.flatMap(row => [row.in ?? 0, row.out ?? 0]));
  const width = 900, height = 230, left = 42, top = 16, plotHeight = 160, plotWidth = width - left - 16;
  const x = (index: number) => left + (rows.length === 1 ? plotWidth / 2 : index / (rows.length - 1) * plotWidth);
  const y = (count: number) => top + plotHeight - count / max * plotHeight;
  const line = (direction: 'in' | 'out') => points.map((point, index) => `${x(index)},${y(point[direction] ?? 0)}`).join(' ');
  const ticks = [...new Set([0, Math.floor((rows.length-1)/4), Math.floor((rows.length-1)/2), Math.floor((rows.length-1)*3/4), rows.length-1])];
  return <div className="chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Biểu đồ số lượt nhập và xuất kho theo thời gian UTC">
    <defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#27846f" stopOpacity=".18"/><stop offset="100%" stopColor="#27846f" stopOpacity="0"/></linearGradient></defs>
    {[0,.25,.5,.75,1].map(fraction => <g key={fraction}><line x1={left} x2={width-16} y1={y(max*fraction)} y2={y(max*fraction)} stroke="#e8eeea" strokeDasharray="4 5" /><text x={left-10} y={y(max*fraction)+4} textAnchor="end" className="chart-label">{Math.round(max*fraction).toLocaleString('vi-VN')}</text></g>)}
    <polygon points={`${x(0)},${y(0)} ${line('in')} ${x(rows.length-1)},${y(0)}`} fill="url(#trend-fill)" />
    <polyline points={line('in')} fill="none" stroke="#23816a" strokeWidth="3" strokeLinejoin="round" />
    <polyline points={line('out')} fill="none" stroke="#e3a45d" strokeWidth="2.5" strokeLinejoin="round" strokeDasharray="6 4" />
    {rows.map((row,index) => <g key={row.period_start}><title>{row.period_start.slice(0,10)} UTC · Nhập {integer(row.in_count)} · Xuất {integer(row.out_count)}</title><circle cx={x(index)} cy={y(points[index]?.in ?? 0)} r="3" fill="#23816a" /><circle cx={x(index)} cy={y(points[index]?.out ?? 0)} r="3" fill="#e3a45d" /></g>)}
    {ticks.map(index => <text key={index} x={x(index)} y={top+plotHeight+28} textAnchor="middle" className="chart-label">{rows[index]?.period_start.slice(5,10).split('-').reverse().join('/')}</text>)}
  </svg><div className="chart-legend"><span><i className="legend-in"/>Lượt nhập</span><span><i className="legend-out"/>Lượt xuất</span><span className="muted">Mốc thời gian UTC</span></div></div>;
}
