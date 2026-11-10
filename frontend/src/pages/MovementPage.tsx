import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Input, Select, Space, Spin, Tabs, Typography } from 'antd';
import { useAuth } from '../auth/AuthProvider';
import { ErrorNotice, ExactNumber, PageHeading, RefreshButton } from '../components/Common';
import { useResource } from '../hooks/useResource';
import { listDatabaseInventory } from '../lib/inventory-api';
import { listDatabaseProducts } from '../lib/products-api';
import { listDatabaseProductUnits } from '../lib/product-units-api';
import { listDatabaseScanPoints } from '../lib/scan-points-api';
import { createStockIn } from '../lib/stock-movements-api';
import type { StockInRequest, StockInResult } from '../lib/stock-movements-api';
import { loadPendingStockIn, savePendingStockIn } from '../lib/pendingStockIn';
import { errorMessage } from '../lib/format';
import { ApiError } from '../lib/api-types';
import Kt2Panel from './Kt2Panel';

function StockInPanel() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [scanCode, setScanCode] = useState('');
  const [scanPointId, setScanPointId] = useState<string>();
  const [pending, setPending] = useState<StockInRequest | null>(null);
  const [completed, setCompleted] = useState<StockInResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>();
  const submitGate = useRef(false);
  const resource = useResource(useCallback(async (signal: AbortSignal) => {
    const [products, units, inventory, points] = await Promise.all([
      listDatabaseProducts({ signal }), listDatabaseProductUnits({ signal }),
      listDatabaseInventory({ signal }), listDatabaseScanPoints({ signal }),
    ]);
    return { products: products.data, units: units.data, inventory: inventory.data, points: points.data };
  }, []));

  useEffect(() => {
    if (!user) return;
    const recovered = loadPendingStockIn(user.user_id);
    if (recovered) {
      setPending(recovered.payload);
      setScanCode(recovered.payload.scan_code);
      setScanPointId(recovered.payload.scan_point_id);
    }
  }, [user]);

  const code = scanCode.trim();
  const unit = useMemo(() => resource.data?.units.find(row => row.scan_code === code), [resource.data, code]);
  const product = resource.data?.products.find(row => row.product_id === unit?.product_id);
  const stock = resource.data?.inventory.find(row => row.product_id === unit?.product_id);
  const point = resource.data?.points.find(row => row.scan_point_id === scanPointId);
  const activePoints = resource.data?.points.filter(row => row.is_active) ?? [];
  const validPreview = !!unit && !!product?.is_active && !!stock && !!point?.is_active;
  const expected = validPreview ? (BigInt(stock.quantity_base) + BigInt(unit.conversion_factor)).toString() : null;
  const canWrite = user?.role === 'ADMIN' || user?.role === 'STAFF';

  async function confirm() {
    if (!user || !canWrite || submitGate.current || completed) return;
    if (!pending && !validPreview) {
      message.error('Chọn điểm quét và mã quét hợp lệ trước khi xác nhận.');
      return;
    }
    const payload: StockInRequest = pending ?? {
      transaction_id: crypto.randomUUID(), scan_code: code,
      scan_point_id: scanPointId!, movement_type: 'IN',
    };
    submitGate.current = true;
    setBusy(true);
    setSubmitError(undefined);
    setPending(payload);
    savePendingStockIn(user.user_id, { payload, createdAt: new Date().toISOString() });
    try {
      const response = await createStockIn(payload);
      setCompleted(response.data);
      setPending(null);
      savePendingStockIn(user.user_id, null);
      resource.reload();
      message.success('Đã nhập kho một đơn vị đóng gói.');
    } catch (error) {
      // A lost response does not prove that the transaction rolled back.
      setSubmitError(error);
    } finally {
      submitGate.current = false;
      setBusy(false);
    }
  }

  function nextScan() {
    if (!completed || busy) return;
    setCompleted(null);
    setScanCode('');
    setSubmitError(undefined);
  }

  function discardRejected() {
    if (!user || !(submitError instanceof ApiError) || ![400, 401, 403, 404, 409].includes(submitError.status) || busy) return;
    savePendingStockIn(user.user_id, null);
    setPending(null);
    setScanCode('');
    setSubmitError(undefined);
  }

  return <div className="page-enter">
    <PageHeading title="Nhập kho bằng mã quét" action={<RefreshButton onClick={resource.reload} loading={resource.loading} />} />
    <Card className="content-card">
      <Typography.Paragraph>Quét hoặc nhập mã, kiểm tra thông tin rồi xác nhận nhập một đơn vị đóng gói.</Typography.Paragraph>
      <ErrorNotice error={resource.error} retry={resource.reload} />
      {resource.loading && <Spin aria-label="Đang tải dữ liệu xem trước" />}
      {pending && <Alert type="warning" showIcon title="Lượt nhập đang được giữ để thử lại" description="Giữ nguyên mã giao dịch và nội dung. Nếu kết quả chưa rõ, bấm Thử lại để xác nhận mà không cộng tồn hai lần." style={{ marginBottom: 16 }} />}
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div><label htmlFor="stock-scan-point">Điểm quét</label><Select id="stock-scan-point" aria-label="Điểm quét" style={{ width: '100%' }} placeholder="Chọn điểm quét đang hoạt động" value={scanPointId} options={activePoints.map(row => ({ value: row.scan_point_id, label: `${row.scan_point_id} — ${row.point_name}` }))} onChange={setScanPointId} disabled={!!pending || !!completed || busy} /></div>
        <div><label htmlFor="stock-scan-code">Mã quét</label><Input id="stock-scan-code" aria-label="Mã quét" placeholder="Nhập, dán hoặc quét mã" maxLength={80} value={scanCode} onChange={event => setScanCode(event.target.value)} onPressEnter={event => event.preventDefault()} disabled={!!pending || !!completed || busy} /></div>
      </Space>
      {!pending && code && !resource.loading && !unit && <Alert type="error" showIcon title="Không tìm thấy mã quét trong dữ liệu hiện tại." style={{ marginTop: 16 }} />}
      {!pending && unit && product && !product.is_active && <Alert type="warning" showIcon title="Sản phẩm đã ngừng hoạt động." style={{ marginTop: 16 }} />}
      {!pending && unit && !stock && !resource.loading && <Alert type="error" showIcon title="Không có dữ liệu tồn kho để xem trước." style={{ marginTop: 16 }} />}
      {validPreview && !completed && <Card size="small" title="Xem trước lượt nhập" style={{ marginTop: 20 }}><Descriptions bordered column={1} items={[
        { key: 'product', label: 'Sản phẩm', children: `${product.product_id} — ${product.product_name}` },
        { key: 'unit', label: 'Đơn vị', children: `${unit.unit_name} (1 ${unit.unit_name} = ${unit.conversion_factor} ${product.base_unit})` },
        { key: 'code', label: 'Mã quét', children: unit.scan_code },
        { key: 'point', label: 'Điểm quét', children: `${point.scan_point_id} — ${point.point_name}` },
        { key: 'current', label: 'Tồn hiện tại (tham khảo)', children: <ExactNumber value={stock.quantity_base} unit={product.base_unit} /> },
        { key: 'add', label: 'Dự kiến nhập', children: <ExactNumber value={String(unit.conversion_factor)} unit={product.base_unit} /> },
        { key: 'expected', label: 'Tồn dự kiến (tham khảo)', children: <ExactNumber value={expected!} unit={product.base_unit} /> },
      ]} /><Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>Tồn thực tế được backend tính khi xác nhận; số xem trước có thể thay đổi.</Typography.Paragraph></Card>}
      {submitError != null && <Alert type="error" showIcon title={errorMessage(submitError)} style={{ marginTop: 16 }} />}
      {completed && <Alert type="success" showIcon title="Đã nhập kho" description={<Descriptions column={1} items={[
        { key: 'transaction', label: 'Mã giao dịch', children: completed.transaction_id },
        { key: 'product', label: 'Sản phẩm', children: `${completed.product_id} — ${completed.product_name}` },
        { key: 'unit', label: 'Đơn vị', children: completed.unit_name },
        { key: 'quantity', label: 'Đã nhập', children: <ExactNumber value={completed.quantity_base} /> },
        { key: 'after', label: 'Tồn sau nhập', children: <ExactNumber value={completed.inventory_after} /> },
      ]} />} style={{ marginTop: 20 }} />}
      <Space style={{ marginTop: 20 }}>
        {!completed && canWrite && <Button type="primary" loading={busy} disabled={busy || resource.loading || (!pending && !validPreview)} onClick={() => { void confirm(); }}>{pending ? 'Thử lại lượt nhập' : 'Xác nhận nhập kho'}</Button>}
        {pending && submitError instanceof ApiError && [400, 401, 403, 404, 409].includes(submitError.status) && <Button disabled={busy} onClick={discardRejected}>Bỏ lượt bị từ chối</Button>}
        {completed && <Button type="primary" onClick={nextScan}>Lượt nhập tiếp theo</Button>}
      </Space>
    </Card>
  </div>;
}

export default function MovementPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('in');
  return <div className="page-enter">
    <PageHeading title="Quản lý nhập/xuất kho" />
    <Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'in', label: 'Nhập kho', forceRender: true, children: <StockInPanel /> },
      { key: 'out', label: 'Xuất kho', children: <Card className="content-card"><Alert type="info" showIcon title="Chức năng xuất kho đang được phát triển." /></Card> },
      ...(user?.role === 'ADMIN' ? [{ key: 'kt2', label: 'Kiểm tra KT2', forceRender: true, children: <Kt2Panel /> }] : []),
    ]} />
  </div>;
}
