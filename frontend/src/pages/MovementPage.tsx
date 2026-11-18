import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Input, InputNumber, Space, Spin, Tabs, Typography } from 'antd';
import { useAuth } from '../auth/AuthProvider';
import { ErrorNotice, ExactNumber, PageHeading, RefreshButton } from '../components/Common';
import { useResource } from '../hooks/useResource';
import { listDatabaseInventory } from '../lib/inventory-api';
import { listDatabaseProducts } from '../lib/products-api';
import { listDatabaseProductUnits } from '../lib/product-units-api';
import { useAssignedScanPoints } from '../hooks/useAssignedScanPoints';
import { AssignedScanPointField } from '../components/AssignedScanPointField';
import { createStockIn } from '../lib/stock-movements-api';
import type { StockInRequest, StockInResult } from '../lib/stock-movements-api';
import { loadPendingStockIn, savePendingStockIn } from '../lib/pendingStockIn';
import { errorMessage } from '../lib/format';
import { ApiError } from '../lib/api-types';
import { newTransactionId } from '../lib/transaction-id';
import Kt2Panel from './Kt2Panel';
import StockOutPanel from './StockOutPanel';

function StockInPanel() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [scanCode, setScanCode] = useState('');
  const [scanPointId, setScanPointId] = useState<string>();
  const [quantityPackages, setQuantityPackages] = useState<number | null>(1);
  const [pending, setPending] = useState<StockInRequest | null>(null);
  const [completed, setCompleted] = useState<StockInResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>();
  const submitGate = useRef(false);
  const assignment = useAssignedScanPoints();
  const resource = useResource(useCallback(async (signal: AbortSignal) => {
    const [products, units, inventory] = await Promise.all([
      listDatabaseProducts({ signal }), listDatabaseProductUnits({ signal }),
      listDatabaseInventory({ signal }),
    ]);
    return { products: products.data, units: units.data, inventory: inventory.data };
  }, []));

  useEffect(() => {
    if (!user) return;
    const recovered = loadPendingStockIn(user.user_id);
    if (recovered) {
      setPending(recovered.payload);
      setScanCode(recovered.payload.scan_code);
      setScanPointId(recovered.payload.scan_point_id);
      setQuantityPackages(recovered.payload.quantity_packages ?? 1);
    }
  }, [user]);

  const code = scanCode.trim();
  const unit = useMemo(() => resource.data?.units.find(row => row.scan_code === code), [resource.data, code]);
  const product = resource.data?.products.find(row => row.product_id === unit?.product_id);
  const stock = resource.data?.inventory.find(row => row.product_id === unit?.product_id);
  const point = assignment.staff ? assignment.single : assignment.points.find(row => row.scan_point_id === scanPointId);
  const pointAllowed = assignment.ready && !!point && (!pending || pending.scan_point_id === point.scan_point_id);
  const validPreview = !!unit && !!product?.is_active && !!stock && !!point?.is_active;
  const quantityValid = Number.isInteger(quantityPackages) && quantityPackages !== null && quantityPackages >= 1 && quantityPackages <= 2147483647;
  const amount = validPreview && quantityValid ? BigInt(unit.conversion_factor) * BigInt(quantityPackages) : null;
  const expectedValue = amount !== null && stock ? BigInt(stock.quantity_base) + amount : null;
  const withinLimit = expectedValue !== null && expectedValue <= 9223372036854775807n;
  const expected = withinLimit ? expectedValue!.toString() : null;
  const canWrite = user?.role === 'ADMIN' || user?.role === 'STAFF';

  async function confirm() {
    if (!user || !canWrite || !pointAllowed || submitGate.current || completed) return;
    if (!pending && (!validPreview || !quantityValid || !withinLimit)) {
      message.error('Chọn điểm quét, mã quét và số đơn vị đóng gói hợp lệ trước khi xác nhận.');
      return;
    }
    let payload: StockInRequest;
    try {
      payload = pending ?? { transaction_id: newTransactionId(), scan_code: code,
        scan_point_id: point!.scan_point_id, movement_type: 'IN', quantity_packages: quantityPackages! };
    } catch (error) { setSubmitError(error); return; }
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
      assignment.reload();
      message.success('Đã nhập kho theo số đơn vị đóng gói đã chọn.');
    } catch (error) {
      // A lost response does not prove that the transaction rolled back.
      setSubmitError(error);
      if (error instanceof ApiError && error.status === 403) assignment.reload();
    } finally {
      submitGate.current = false;
      setBusy(false);
    }
  }

  function nextScan() {
    if (!completed || busy) return;
    setCompleted(null);
    setScanCode('');
    setQuantityPackages(1);
    setSubmitError(undefined);
  }

  function discardRejected() {
    if (!user || !(submitError instanceof ApiError) || ![400, 401, 403, 404, 409].includes(submitError.status) || busy) return;
    savePendingStockIn(user.user_id, null);
    setPending(null);
    setScanCode('');
    setQuantityPackages(1);
    setSubmitError(undefined);
  }

  return <div className="page-enter">
    <PageHeading title="Nhập kho bằng mã quét" action={<RefreshButton onClick={() => { resource.reload(); assignment.reload(); }} loading={resource.loading || assignment.loading} />} />
    <Card className="content-card">
      <Typography.Paragraph>Quét hoặc nhập mã, chọn số đơn vị đóng gói rồi kiểm tra trước khi xác nhận nhập.</Typography.Paragraph>
      <ErrorNotice error={resource.error} retry={resource.reload} />
      {resource.loading && <Spin aria-label="Đang tải dữ liệu xem trước" />}
      {pending && <Alert type="warning" showIcon title="Lượt nhập đang được giữ để thử lại" description="Giữ nguyên mã giao dịch và nội dung. Nếu kết quả chưa rõ, bấm Thử lại để xác nhận mà không cộng tồn hai lần." style={{ marginBottom: 16 }} />}
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <AssignedScanPointField assignment={assignment} adminPointId={scanPointId} onAdminChange={setScanPointId} label="Điểm quét" frozen={!!pending || !!completed || busy} pendingPointId={pending?.scan_point_id} />
        <div><label htmlFor="stock-scan-code">Mã quét</label><Input id="stock-scan-code" aria-label="Mã quét" placeholder="Nhập, dán hoặc quét mã" maxLength={80} value={scanCode} onChange={event => setScanCode(event.target.value)} onPressEnter={event => event.preventDefault()} disabled={!!pending || !!completed || busy} /></div>
        <div><label htmlFor="stock-quantity-packages">Số đơn vị đóng gói nhập</label><InputNumber id="stock-quantity-packages" aria-label="Số đơn vị đóng gói nhập" min={1} max={2147483647} precision={0} style={{ width: '100%' }} value={quantityPackages} onChange={setQuantityPackages} disabled={!!pending || !!completed || busy} /></div>
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
        { key: 'add', label: 'Dự kiến nhập', children: amount === null ? 'Số lượng không hợp lệ' : <ExactNumber value={amount.toString()} unit={product.base_unit} /> },
        { key: 'expected', label: 'Tồn dự kiến (tham khảo)', children: expected === null ? 'Vượt giới hạn tồn kho' : <ExactNumber value={expected} unit={product.base_unit} /> },
      ]} /></Card>}
      {submitError != null && <Alert type="error" showIcon title={errorMessage(submitError)} style={{ marginTop: 16 }} />}
      {completed && <Alert type="success" showIcon title="Đã nhập kho" description={<Descriptions column={1} items={[
        { key: 'transaction', label: 'Mã giao dịch', children: completed.transaction_id },
        { key: 'product', label: 'Sản phẩm', children: `${completed.product_id} — ${completed.product_name}` },
        { key: 'unit', label: 'Đơn vị', children: completed.unit_name },
        { key: 'packages', label: 'Số đơn vị đóng gói', children: `${completed.quantity_packages} ${completed.unit_name}` },
        { key: 'quantity', label: 'Đã nhập', children: <ExactNumber value={completed.quantity_base} /> },
        { key: 'after', label: 'Tồn sau nhập', children: <ExactNumber value={completed.inventory_after} /> },
      ]} />} style={{ marginTop: 20 }} />}
      <Space style={{ marginTop: 20 }}>
        {!completed && canWrite && <Button type="primary" loading={busy} disabled={busy || !pointAllowed || (!pending && (resource.loading || !validPreview || !quantityValid || !withinLimit))} onClick={() => { void confirm(); }}>{pending ? 'Thử lại lượt nhập' : 'Xác nhận nhập kho'}</Button>}
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
      { key: 'out', label: 'Xuất kho', children: <StockOutPanel /> },
      ...(user?.role === 'ADMIN' ? [{ key: 'kt2', label: 'Kiểm tra KT2', forceRender: true, children: <Kt2Panel /> }] : []),
    ]} />
  </div>;
}
