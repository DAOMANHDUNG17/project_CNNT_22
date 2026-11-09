import { ApiError } from './api';
import type { Role } from './api';

export const roleLabels: Record<Role, string> = { ADMIN: 'Quản trị viên', KEEPER: 'Thủ kho', STAFF: 'Nhân viên', VIEWER: 'Người xem' };
export const roleOptions = Object.entries(roleLabels).map(([value, label]) => ({ value, label }));
export const integer = (value: string) => /^[0-9]+$/u.test(value) ? BigInt(value).toLocaleString('vi-VN') : value;
export function timestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
  }).format(date);
}
export function chartCount(value: string): number | null {
  if (!/^[0-9]+$/u.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}
const errors: Record<string, string> = {
  AUTH_SIGN_IN_FAILED: 'Không thể đăng nhập. Kiểm tra email, mật khẩu hoặc thử lại sau.',
  AUTH_UNAVAILABLE: 'Không thể làm mới phiên đăng nhập. Vui lòng thử lại.',
  AUTH_PROVIDER_UNAVAILABLE: 'Dịch vụ xác thực tạm thời không khả dụng.',
  AUTHORIZATION_UNAVAILABLE: 'Chưa kiểm tra được quyền truy cập. Vui lòng thử lại.',
  CLOUD_ACCOUNT_OPERATION_BLOCKED: 'Tạo tài khoản và đổi mật khẩu Cloud chưa khả dụng.',
  PROVIDER_SIGN_OUT_FAILED: 'Phiên ứng dụng đã bị thu hồi. Chưa xác nhận đăng xuất với dịch vụ xác thực.',
  INVALID_CREDENTIALS: 'Tên đăng nhập hoặc mật khẩu không đúng.',
  AUTHENTICATION_REQUIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  FORBIDDEN: 'Tài khoản không có quyền thực hiện thao tác này.',
  ORIGIN_FORBIDDEN: 'Địa chỉ ứng dụng chưa được cho phép. Kiểm tra origin và proxy.',
  CSRF_FAILED: 'Token bảo vệ phiên không còn hợp lệ. Làm mới phiên rồi thử lại.',
  INVALID_BODY: 'Dữ liệu chưa hợp lệ. Kiểm tra các trường trong biểu mẫu.',
  INVALID_QUERY: 'Bộ lọc chưa hợp lệ. Vui lòng kiểm tra lại.',
  INSUFFICIENT_INVENTORY: 'Không đủ tồn kho để xuất số lượng này.',
  IDEMPOTENCY_CONFLICT: 'Mã giao dịch đã gắn với yêu cầu khác. Không thay UUID để thử lại yêu cầu này.',
  IDEMPOTENCY_LEGACY_RECORD: 'Đây là giao dịch lịch sử không hỗ trợ phát lại yêu cầu.',
  INVALID_SCAN_POINT: 'Điểm quét không tồn tại hoặc đã ngừng hoạt động.',
  INVALID_SCAN_CODE: 'Mã quét không tồn tại. Kiểm tra đơn vị sản phẩm.',
  PRODUCT_INACTIVE: 'Sản phẩm đã ngừng hoạt động.',
  PRODUCT_HAS_STOCK: 'Không thể ngừng hoạt động sản phẩm khi vẫn còn tồn kho.',
  STOCK_LIMIT_EXCEEDED: 'Số lượng vượt giới hạn tồn kho cho phép.',
  LAST_ADMIN_REQUIRED: 'Phải giữ lại ít nhất một quản trị viên đang hoạt động.',
  UNSAFE_UNIT_CHANGE: 'Không thể đổi đơn vị đang sử dụng. Hãy tạo đơn vị và mã quét mới.',
  RESOURCE_CONFLICT: 'Mã hoặc tên này đã tồn tại.',
  PRODUCT_ID_CONFLICT: 'Mã sản phẩm đã tồn tại. Vui lòng chọn mã khác.',
  SCAN_CODE_CONFLICT: 'Mã quét đã tồn tại. Vui lòng nhập mã khác.',
  UNIT_NAME_CONFLICT: 'Tên đơn vị đã tồn tại cho sản phẩm này.',
  BASE_UNIT_CONFLICT: 'Sản phẩm đã có đơn vị cơ sở.',
  BASE_UNIT_FACTOR_INVALID: 'Hệ số của đơn vị cơ sở phải bằng 1.',
  BASE_UNIT_NAME_INVALID: 'Tên đơn vị cơ sở phải trùng với đơn vị cơ sở của sản phẩm.',
  RESOURCE_NOT_FOUND: 'Không tìm thấy đối tượng này.',
  PRODUCT_NOT_FOUND: 'Không tìm thấy sản phẩm.',
  PRODUCT_UNIT_NOT_FOUND: 'Không tìm thấy đơn vị đóng gói.',
  BASE_UNIT_FACTOR_CHANGE_FORBIDDEN: 'Không thể thay đổi hệ số quy đổi của đơn vị cơ sở.',
  BASE_UNIT_DATA_MISMATCH: 'Tên đơn vị cơ sở hiện không khớp với sản phẩm. Cần kiểm tra dữ liệu trước khi chỉnh sửa.',
  BASE_UNIT_SYNC_REQUIRED: 'Tên đơn vị cơ sở chưa thống nhất. Vui lòng nhập tên đơn vị để đồng bộ.',
  BACKEND_UNIT_ROUTE_MISSING: 'Backend chưa có route sửa đơn vị đóng gói. Hãy khởi động lại backend.',
  UNIT_HAS_TRANSACTIONS: 'Không thể thay đổi hệ số quy đổi vì đơn vị này đã phát sinh giao dịch nhập/xuất.',
  UNIT_PRODUCT_HAS_STOCK: 'Không thể thay đổi hệ số quy đổi khi sản phẩm vẫn còn tồn kho.',
  BACKEND_ROUTE_MISSING: 'Backend chưa có route sửa sản phẩm. Hãy khởi động lại backend.',
  INVENTORY_NOT_FOUND: 'Sản phẩm chưa có bản ghi tồn kho.',
  TRANSACTION_NOT_FOUND: 'Không tìm thấy giao dịch.',
  SESSION_STORE_UNAVAILABLE: 'Dịch vụ phiên tạm thời không khả dụng. Vui lòng thử lại sau.',
  DATABASE_UNAVAILABLE: 'Chưa kết nối được dữ liệu kho. Vui lòng thử lại sau.',
  TRANSACTION_OUTCOME_UNKNOWN: 'Chưa xác định giao dịch đã hoàn tất hay chưa. Kiểm tra lại với cùng UUID và nội dung.',
  STOCK_BUSY: 'Kho đang xử lý yêu cầu khác. Thử lại với cùng UUID và nội dung.',
};
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'STOCK_MOVEMENT_ERROR') return error.message;
    if (error.status === 429) return `Quá nhiều yêu cầu. Thử lại sau ${error.retryAfter ?? 900} giây.`;
    return errors[error.code] ?? (error.status === 503 ? 'Dịch vụ tạm thời không khả dụng. Vui lòng thử lại sau.' : 'Không thể hoàn tất yêu cầu. Vui lòng kiểm tra lại.');
  }
  if (error instanceof Error && error.name === 'TimeoutError') return 'Yêu cầu quá thời gian chờ. Vui lòng thử lại.';
  return 'Không nhận được phản hồi từ máy chủ. Kiểm tra kết nối và thử lại.';
}
export const textRules = (max: number) => [{ required: true, message: 'Vui lòng nhập thông tin.' }, {
  validator: (_: unknown, value: unknown) => typeof value === 'string' && value === value.trim()
    && [...value].length > 0 && [...value].length <= max && !value.includes('\0')
    ? Promise.resolve() : Promise.reject(new Error(`Nhập 1–${max} ký tự, không có khoảng trắng đầu/cuối.`)),
}];
export const passwordRules = [{ required: true, message: 'Vui lòng nhập mật khẩu.' }, {
  validator: (_: unknown, value: unknown) => typeof value === 'string' && [...value].length >= 12
    && [...value].length <= 128 && new TextEncoder().encode(value).length <= 512 && !value.includes('\0')
    ? Promise.resolve() : Promise.reject(new Error('Mật khẩu cần 12–128 ký tự, tối đa 512 byte.')),
}];
export function validThreshold(value: string): boolean {
  return /^(0|[1-9]\d{0,18})$/u.test(value) && BigInt(value) <= 9223372036854775807n;
}
