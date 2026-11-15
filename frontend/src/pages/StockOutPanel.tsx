import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Input, InputNumber, Select, Space, Spin, Typography } from 'antd';
import { useAuth } from '../auth/AuthProvider';
import { ErrorNotice, ExactNumber, PageHeading, RefreshButton } from '../components/Common';
import { useResource } from '../hooks/useResource';
import { listDatabaseInventory } from '../lib/inventory-api';
import { listDatabaseProducts } from '../lib/products-api';
import { listDatabaseProductUnits } from '../lib/product-units-api';
import { listDatabaseScanPoints } from '../lib/scan-points-api';
import { createStockOut } from '../lib/stock-movements-api';
import type { StockOutRequest, StockOutResult } from '../lib/stock-movements-api';
import { loadPendingStockOut, savePendingStockOut } from '../lib/pendingStockOut';
import { ApiError } from '../lib/api-types';
import { errorMessage } from '../lib/format';

export default function StockOutPanel() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [scanCode, setScanCode] = useState('');
  const [scanPointId, setScanPointId] = useState<string>();
  const [quantityPackages, setQuantityPackages] = useState<number | null>(1);
  const [pending, setPending] = useState<StockOutRequest | null>(null);
  const [completed, setCompleted] = useState<StockOutResult | null>(null);
  const [completedBaseUnit, setCompletedBaseUnit] = useState<string>();
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
    const recovered = loadPendingStockOut(user.user_id);
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
  const point = resource.data?.points.find(row => row.scan_point_id === scanPointId);
  const activePoints = resource.data?.points.filter(row => row.is_active) ?? [];
  const validPreview = !!unit && !!product?.is_active && !!stock && !!point?.is_active;
  const quantityValid = Number.isInteger(quantityPackages) && quantityPackages !== null && quantityPackages >= 1 && quantityPackages <= 2147483647;
  const amount = validPreview && quantityValid ? BigInt(unit.conversion_factor) * BigInt(quantityPackages) : null;
  const sufficient = amount !== null && stock !== undefined && BigInt(stock.quantity_base) >= amount;
  const expected = sufficient && stock && amount !== null ? (BigInt(stock.quantity_base) - amount).toString() : null;
  const canWrite = user?.role === 'ADMIN' || user?.role === 'STAFF';

  async function confirm() {
    if (!user || !canWrite || submitGate.current || completed) return;
    if (!pending && (!validPreview || !quantityValid || !sufficient)) {
      message.error('Chọn điểm quét, mã quét hợp lệ và kiểm tra đủ tồn trước khi xác nhận.');
      return;
    }
    const payload: StockOutRequest = pending ?? {
      transaction_id: crypto.randomUUID(), scan_code: code,
      scan_point_id: scanPointId!, movement_type: 'OUT', quantity_packages: quantityPackages!,
    };
    submitGate.current = true;
    setBusy(true);
    setSubmitError(undefined);
    setPending(payload);
    savePendingStockOut(user.user_id, { payload, createdAt: new Date().toISOString() });
    try {
      const response = await createStockOut(payload);
      setCompletedBaseUnit(product?.base_unit);
      setCompleted(response.data);
      setPending(null);
      savePendingStockOut(user.user_id, null);
      resource.reload();
      message.success('Đã xuất kho theo số đơn vị đóng gói đã chọn.');
    } catch (error) {
      setSubmitError(error);
      if (error instanceof ApiError && error.status === 409) resource.reload();
    } finally {
      submitGate.current = false;
      setBusy(false);
    }
  }

  function nextScan() {
    if (!completed || busy) return;
    setCompleted(null);
    setCompletedBaseUnit(undefined);
    setScanCode('');
    setQuantityPackages(1);
    setSubmitError(undefined);
  }

  function discardRejected() {
    if (!user || !(submitError instanceof ApiError) || ![400, 401, 403, 404, 409].includes(submitError.status) || busy) return;
    savePendingStockOut(user.user_id, null);
    setPending(null);
    setScanCode('');
    setQuantityPackages(1);
    setSubmitError(undefined);
  }

  return <div className="page-enter">
    <PageHeading title="Xuất kho bằng mã quét" action={<RefreshButton onClick={resource.reload} loading={resource.loading} />} />
    <Card className="content-card">
      <Typography.Paragraph>Quét hoặc nhập mã, chọn số đơn vị đóng gói rồi kiểm tra tồn trước khi xác nhận xuất.</Typography.Paragraph>
      <ErrorNotice error={resource.error} retry={resource.reload} />
      {resource.loading && <Spin aria-label="Đang tải dữ liệu xem trước xuất kho" />}
      {pending && <Alert type="warning" showIcon title="Lượt xuất đang được giữ để thử lại" description="Giữ nguyên mã giao dịch và nội dung. Nếu kết quả chưa rõ, bấm Thử lại để xác nhận mà không trừ tồn hai lần." style={{ marginBottom: 16 }} />}
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div><label htmlFor="out-scan-point">Điểm quét</label><Select id="out-scan-point" aria-label="Điểm quét xuất kho" style={{ width: '100%' }} placeholder="Chọn điểm quét đang hoạt động" value={scanPointId} options={activePoints.map(row => ({ value: row.scan_point_id, label: `${row.scan_point_id} — ${row.point_name}` }))} onChange={setScanPointId} disabled={!!pending || !!completed || busy} /></div>
        <div><label htmlFor="out-scan-code">Mã quét</label><Input id="out-scan-code" aria-label="Mã quét xuất kho" placeholder="Nhập, dán hoặc quét mã" maxLength={80} value={scanCode} onChange={event => setScanCode(event.target.value)} onPressEnter={event => event.preventDefault()} disabled={!!pending || !!completed || busy} /></div>
        <div><label htmlFor="out-quantity-packages">Số đơn vị đóng gói xuất</label><InputNumber id="out-quantity-packages" aria-label="Số đơn vị đóng gói xuất" min={1} max={2147483647} precision={0} style={{ width: '100%' }} value={quantityPackages} onChange={setQuantityPackages} disabled={!!pending || !!completed || busy} /></div>
      </Space>
      {!pending && code && !resource.loading && !unit && <Alert type="error" showIcon title="Không tìm thấy mã quét trong dữ liệu hiện tại." style={{ marginTop: 16 }} />}
      {!pending && unit && product && !product.is_active && <Alert type="warning" showIcon title="Sản phẩm đã ngừng hoạt động." style={{ marginTop: 16 }} />}
      {!pending && unit && !stock && !resource.loading && <Alert type="error" showIcon title="Không có dữ liệu tồn kho để xem trước." style={{ marginTop: 16 }} />}
      {validPreview && !completed && <Card size="small" title="Xem trước lượt xuất" style={{ marginTop: 20 }}><Descriptions bordered column={1} items={[
        { key: 'product', label: 'Sản phẩm', children: `${product.product_id} — ${product.product_name}` },
        { key: 'unit', label: 'Đơn vị', children: `${unit.unit_name} (1 ${unit.unit_name} = ${unit.conversion_factor} ${product.base_unit})` },
        { key: 'code', label: 'Mã quét', children: unit.scan_code },
        { key: 'point', label: 'Điểm quét', children: `${point.scan_point_id} — ${point.point_name}` },
        { key: 'current', label: 'Tồn hiện tại (tham khảo)', children: <ExactNumber value={stock.quantity_base} unit={product.base_unit} /> },
        { key: 'remove', label: 'Dự kiến xuất', children: amount === null ? 'Số lượng không hợp lệ' : <ExactNumber value={amount.toString()} unit={product.base_unit} /> },
        { key: 'expected', label: 'Tồn dự kiến còn lại (tham khảo)', children: expected === null ? 'Không đủ tồn' : <ExactNumber value={expected} unit={product.base_unit} /> },
      ]} /><Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>Tồn thực tế được backend kiểm tra lại khi xác nhận; số xem trước có thể thay đổi.</Typography.Paragraph></Card>}
      {validPreview && quantityValid && !sufficient && !pending && <Alert type="warning" showIcon title="Không đủ tồn kho để xuất." style={{ marginTop: 16 }} />}
      {submitError != null && <Alert type="error" showIcon title={errorMessage(submitError)} style={{ marginTop: 16 }} />}
      {completed && <Alert type="success" showIcon title="Đã xuất kho" description={<Descriptions column={1} items={[
        { key: 'transaction', label: 'Mã giao dịch', children: completed.transaction_id },
        { key: 'product', label: 'Sản phẩm', children: `${completed.product_id} — ${completed.product_name}` },
        { key: 'unit', label: 'Đơn vị', children: completed.unit_name },
        { key: 'packages', label: 'Số đơn vị đóng gói', children: `${completed.quantity_packages} ${completed.unit_name}` },
        { key: 'quantity', label: 'Đã xuất', children: <ExactNumber value={completed.quantity_base} unit={completedBaseUnit ?? product?.base_unit} /> },
        { key: 'after', label: 'Tồn sau xuất', children: <ExactNumber value={completed.inventory_after} unit={completedBaseUnit ?? product?.base_unit} /> },
      ]} />} style={{ marginTop: 20 }} />}
      <Space style={{ marginTop: 20 }}>
        {!completed && canWrite && <Button type="primary" loading={busy} disabled={busy || (!pending && (resource.loading || !validPreview || !quantityValid || !sufficient))} onClick={() => { void confirm(); }}>{pending ? 'Thử lại lượt xuất' : 'Xác nhận xuất kho'}</Button>}
        {pending && submitError instanceof ApiError && [400, 401, 403, 404, 409].includes(submitError.status) && <Button disabled={busy} onClick={discardRejected}>Bỏ lượt bị từ chối</Button>}
        {completed && <Button type="primary" onClick={nextScan}>Lượt xuất tiếp theo</Button>}
      </Space>
    </Card>
  </div>;
}
