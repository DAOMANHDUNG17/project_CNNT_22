import { useRef, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Input, Modal, Space, Table, Typography } from 'antd';
import { useAuth } from '../auth/AuthProvider';
import type { DatabaseTransaction } from '../lib/api-types';
import { ApiError } from '../lib/api-types';
import { errorMessage, integer, timestamp } from '../lib/format';
import { readKt2State, originalRetryPayload, transactionUuid } from '../lib/kt2';
import type { Kt2State } from '../lib/kt2';
import { retryStockIn } from '../lib/stock-movements-api';
import { listDatabaseTransactions } from '../lib/transactions-api';

type Verdict = 'PASS' | 'FAIL' | 'CHƯA ĐỦ BẰNG CHỨNG' | 'CHƯA THỂ KẾT LUẬN DO CÓ HOẠT ĐỘNG ĐỒNG THỜI';
interface CheckResult {
  verdict: Verdict;
  detail: string;
  http?: number;
  responseId?: string;
  before: Kt2State;
  after?: Kt2State;
  checkedAt: string;
}

const label = (value: string | null) => value ?? 'Thiếu thông tin liên kết';
const failureText = (error: unknown) => error instanceof ApiError ? errorMessage(error)
  : error instanceof Error && error.message.startsWith('Không thể xác minh') ? error.message : errorMessage(error);

export default function Kt2Panel() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [uuid, setUuid] = useState('');
  const [row, setRow] = useState<DatabaseTransaction>();
  const [before, setBefore] = useState<Kt2State>();
  const [result, setResult] = useState<CheckResult>();
  const [lookupError, setLookupError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const runGate = useRef(false);
  const lookupVersion = useRef(0);
  const normalized = uuid.trim();
  const validUuid = transactionUuid.test(normalized);
  const ownTransaction = !!row && row.user_id === user?.user_id;
  const complete = !!row && row.movement_type === 'IN' && !!row.scan_code_snapshot && !!row.scan_point_id
    && row.quantity_packages === 1 && row.conversion_factor_snapshot >= 1;
  const eligible = user?.role === 'ADMIN' && ownTransaction && complete && !!before && before.uuidCount === 1;

  function editUuid(value: string) {
    lookupVersion.current++;
    setUuid(value);
    setLoading(false);
    setRow(undefined); setBefore(undefined); setResult(undefined);
    setLookupError(''); setNotFound(false); setConfirmOpen(false);
  }

  async function lookup() {
    if (!validUuid || loading || running) return;
    const version = ++lookupVersion.current;
    setLoading(true); setLookupError(''); setNotFound(false);
    setRow(undefined); setBefore(undefined); setResult(undefined);
    try {
      const found = await listDatabaseTransactions({ transactionId: normalized, page: 1, limit: 1 });
      if (version !== lookupVersion.current) return;
      if (found.pagination.total === 0 && found.data.length === 0) { setNotFound(true); return; }
      const original = found.data[0];
      if (found.pagination.total !== 1 || found.data.length !== 1 || !original || original.transaction_id.toLowerCase() !== normalized.toLowerCase()) {
        throw new Error('Không thể xác minh giao dịch theo UUID.');
      }
      setRow(original);
      if (original.movement_type !== 'IN' || original.user_id !== user?.user_id) return;
      const state = await readKt2State(original);
      if (version === lookupVersion.current) setBefore(state);
    } catch (error) {
      if (version === lookupVersion.current) setLookupError(failureText(error));
    } finally {
      if (version === lookupVersion.current) setLoading(false);
    }
  }

  async function reloadBefore() {
    if (!row || loading || running) return;
    const version = ++lookupVersion.current;
    setLoading(true); setLookupError(''); setBefore(undefined); setResult(undefined);
    try { const state = await readKt2State(row); if (version === lookupVersion.current) setBefore(state); }
    catch (error) { if (version === lookupVersion.current) setLookupError(failureText(error)); }
    finally { if (version === lookupVersion.current) setLoading(false); }
  }

  async function execute() {
    setConfirmOpen(false);
    if (!row || !eligible || runGate.current) return;
    runGate.current = true; setRunning(true); setResult(undefined);
    let currentBefore: Kt2State;
    try {
      currentBefore = await readKt2State(row);
      setBefore(currentBefore);
    } catch (error) {
      setLookupError(failureText(error));
      runGate.current = false; setRunning(false);
      return;
    }
    let http: number | undefined;
    let responseId: string | undefined;
    let postError: unknown;
    try {
      const response = await retryStockIn(originalRetryPayload(row));
      http = response.status;
      responseId = response.data.data.transaction_id;
    } catch (error) {
      postError = error;
      if (error instanceof ApiError) http = error.status;
    }
    let after: Kt2State | undefined;
    try { after = await readKt2State(row); }
    catch { /* An unreadable after-state cannot prove KT2. */ }
    const unchanged = !!after && after.inventory === currentBefore.inventory
      && after.total === currentBefore.total && after.uuidCount === 1;
    const concurrent = !!after && (after.inventory !== currentBefore.inventory || after.total !== currentBefore.total);
    let verdict: Verdict = 'CHƯA ĐỦ BẰNG CHỨNG';
    let detail = postError ? failureText(postError) : 'Không đọc được đầy đủ trạng thái sau kiểm thử.';
    if (http === 200 && responseId === row.transaction_id && unchanged) {
      verdict = 'PASS'; detail = 'Retry trả về giao dịch gốc; tồn kho và số giao dịch giữ nguyên.';
    } else if (concurrent) {
      verdict = 'CHƯA THỂ KẾT LUẬN DO CÓ HOẠT ĐỘNG ĐỒNG THỜI';
      detail = 'Tồn kho hoặc tổng giao dịch đã thay đổi trong lúc kiểm thử. Hãy thử lại khi không có thao tác kho khác.';
    } else if (after && (http === 200 || http === 201 || http === 409 || http === 400 || http === 401 || http === 403)) {
      verdict = 'FAIL';
      detail = postError ? failureText(postError) : 'HTTP, UUID hoặc dữ liệu đối chiếu không đáp ứng điều kiện KT2.';
    }
    setResult({ verdict, detail, http, responseId, before: currentBefore, after, checkedAt: new Date().toISOString() });
    runGate.current = false; setRunning(false);
    if (verdict === 'PASS') message.success('KT2 PASS: tồn kho không bị cộng hai lần.');
  }

  if (user?.role !== 'ADMIN') return <Alert type="error" showIcon title="Chỉ ADMIN được kiểm tra KT2." />;
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <Card title="Kiểm tra chống trùng giao dịch (KT2)">
      <Typography.Paragraph>Gửi lại mã giao dịch đã tồn tại để xác minh tồn kho không bị thay đổi hai lần.</Typography.Paragraph>
      <Space wrap><Input aria-label="UUID giao dịch KT2" placeholder="Dán UUID đầy đủ từ Lịch sử giao dịch" value={uuid}
        onChange={event => editUuid(event.target.value)} onPressEnter={() => { void lookup(); }}
        disabled={running} maxLength={36} status={uuid && !validUuid ? 'error' : ''} style={{ width: 'min(100%, 390px)' }} />
        <Button type="primary" loading={loading} disabled={!validUuid || running} onClick={() => { void lookup(); }}>Tra cứu giao dịch</Button></Space>
      {uuid && !validUuid && <Alert type="warning" showIcon title="UUID phải đúng định dạng 36 ký tự." style={{ marginTop: 12 }} />}
      {notFound && <Alert type="warning" showIcon title="Không tìm thấy giao dịch đã hoàn thành." style={{ marginTop: 12 }} />}
      {lookupError && <Alert type="error" showIcon title={lookupError} action={row && <Button size="small" onClick={() => { void reloadBefore(); }}>Tải lại trạng thái</Button>} style={{ marginTop: 12 }} />}
    </Card>
    {row && <Card title="Giao dịch gốc"><Descriptions bordered column={1} size="small" items={[
      { key: 'uuid', label: 'UUID đầy đủ', children: <Typography.Text style={{ wordBreak: 'break-all' }}>{row.transaction_id}</Typography.Text> },
      { key: 'product', label: 'Sản phẩm', children: `${row.product_id} · ${label(row.product_name)}` },
      { key: 'scan', label: 'Mã quét snapshot', children: row.scan_code_snapshot },
      { key: 'point', label: 'Điểm quét gốc', children: `${row.scan_point_id} · ${label(row.point_name)}` },
      { key: 'type', label: 'Loại giao dịch', children: row.movement_type },
      { key: 'actor', label: 'Người thực hiện', children: `${label(row.display_name)} (ID ${row.user_id})` },
      { key: 'time', label: 'Thời gian (UTC+7)', children: timestamp(row.created_at) },
      { key: 'packages', label: 'Số đơn vị đóng gói', children: row.quantity_packages },
      { key: 'factor', label: 'Hệ số snapshot', children: row.conversion_factor_snapshot },
      { key: 'quantity', label: 'Số lượng quy đổi', children: integer(row.quantity_base) },
      { key: 'oldBefore', label: 'Tồn trước giao dịch gốc', children: integer(row.inventory_before) },
      { key: 'oldAfter', label: 'Tồn sau giao dịch gốc', children: integer(row.inventory_after) },
    ]} />
      {row.movement_type !== 'IN' && <Alert type="warning" showIcon title="Chỉ giao dịch IN được kiểm tra bằng API hiện tại." style={{ marginTop: 12 }} />}
      {!ownTransaction && <Alert type="warning" showIcon title="Giao dịch này do tài khoản khác thực hiện. Hãy đăng nhập đúng tài khoản gốc để kiểm tra KT2." style={{ marginTop: 12 }} />}
      {!complete && row.movement_type === 'IN' && <Alert type="warning" showIcon title="Dữ liệu giao dịch gốc chưa đủ để gửi lại an toàn." style={{ marginTop: 12 }} />}
    </Card>}
    {row && ownTransaction && row.movement_type === 'IN' && <Card title="Trước kiểm thử">
      {before ? <Descriptions bordered column={1} size="small" items={[
        { key: 'inventory', label: 'Tồn kho hiện tại trước retry', children: integer(before.inventory) },
        { key: 'total', label: 'Tổng giao dịch sản phẩm', children: before.total },
        { key: 'count', label: 'Bản ghi trùng UUID', children: before.uuidCount },
      ]} /> : <Typography.Text type="secondary">Chưa đọc được trạng thái trước kiểm thử.</Typography.Text>}
      <div style={{ marginTop: 16 }}><Button type="primary" loading={running} disabled={!eligible || loading || running}
        onClick={() => setConfirmOpen(true)}>Thực hiện kiểm thử KT2</Button></div>
    </Card>}
    {result && <Card title="Kết quả đối chiếu">
      <Alert type={result.verdict === 'PASS' ? 'success' : result.verdict === 'FAIL' ? 'error' : 'warning'} showIcon
        title={`KT2: ${result.verdict}`} description={result.detail} style={{ marginBottom: 16 }} />
      <Descriptions column={1} size="small" items={[
        { key: 'http', label: 'HTTP thực tế', children: result.http ?? 'Không nhận được HTTP' },
        { key: 'response', label: 'UUID từ response', children: result.responseId ?? 'Không có' },
        { key: 'original', label: 'UUID gốc', children: row?.transaction_id },
        { key: 'time', label: 'Thời gian kiểm thử (UTC+7)', children: timestamp(result.checkedAt) },
      ]} />
      <Table pagination={false} rowKey="key" size="small" scroll={{ x: 480 }} dataSource={[
        { key: 'inventory', criterion: 'Tồn kho', before: integer(result.before.inventory), after: result.after ? integer(result.after.inventory) : 'Chưa đọc được' },
        { key: 'total', criterion: 'Tổng số giao dịch', before: result.before.total, after: result.after?.total ?? 'Chưa đọc được' },
        { key: 'uuid', criterion: 'Số bản ghi UUID', before: result.before.uuidCount, after: result.after?.uuidCount ?? 'Chưa đọc được' },
      ]} columns={[{ title: 'Chỉ tiêu', dataIndex: 'criterion' }, { title: 'Trước', dataIndex: 'before' }, { title: 'Sau', dataIndex: 'after' }]} />
    </Card>}
    <Modal title="Xác nhận kiểm thử KT2" open={confirmOpen} okText="Gửi lại giao dịch gốc" okButtonProps={{ disabled: !eligible || running }}
      onOk={() => { void execute(); }} onCancel={() => setConfirmOpen(false)}>
      Bạn đang gửi lại một giao dịch đã tồn tại. Hệ thống phải trả về kết quả retry và không thay đổi tồn kho.
    </Modal>
  </Space>;
}
