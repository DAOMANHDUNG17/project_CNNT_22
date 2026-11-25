import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SupabaseAdminService {
  private readonly logger = new Logger(SupabaseAdminService.name);
  constructor(private readonly config: ConfigService) {}

  private settings() {
    const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    const url = this.config.get<string>('SUPABASE_URL');
    let origin: URL | undefined;
    try { origin = url ? new URL(url) : undefined; } catch { /* handled below without echoing settings */ }
    if (!key?.trim() || !origin || origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || !['', '/'].includes(origin.pathname)) {
      throw new ServiceUnavailableException('Chưa cấu hình dịch vụ quản trị tài khoản.');
    }
    return { url: origin.origin, key };
  }

  async create(email: string, password: string): Promise<string> {
    const { url, key } = this.settings();
    let response: Response;
    try {
      response = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, email_confirm: true }), signal: AbortSignal.timeout(10000),
      });
    } catch {
      this.logger.error('Auth creation outcome unknown; reconcile Auth before retrying user provisioning');
      throw new ServiceUnavailableException('Chưa xác định kết quả tạo tài khoản. Kiểm tra danh sách trước khi thử lại.');
    }
    const body = await response.json().catch(() => null) as { id?: string; code?: string; error_code?: string } | null;
    if (!response.ok) {
      if (['email_exists', 'user_already_exists'].includes(body?.error_code ?? body?.code ?? '')) {
        throw new ConflictException('Email đã được sử dụng.');
      }
      throw new ServiceUnavailableException('Không thể tạo tài khoản Supabase Auth.');
    }
    if (!body?.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) {
      this.logger.error('Auth creation returned no valid UUID; manual reconciliation required');
      throw new ServiceUnavailableException('Chưa xác nhận được tài khoản Supabase Auth.');
    }
    return body.id;
  }

  async remove(id: string): Promise<void> {
    const { url, key } = this.settings();
    const response = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok && response.status !== 404) throw new Error('Auth compensation failed');
  }

  // Official Supabase Auth HTTP API, matching the existing provisioning client.
  // Never log/return request bodies, provider messages, sessions or credentials.
  private async passwordRequest(path: string, token: string, method = 'GET', body?: object) {
    const { url, key } = this.settings();
    try {
      return await fetch(`${url}/auth/v1${path}`, {
        method, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new ServiceUnavailableException('Chưa xác định được kết quả từ dịch vụ Auth. Không gửi lại tự động; hãy kiểm tra đăng nhập trước khi thử lại.');
    }
  }

  private async passwordError(response: Response, operation: 'identity' | 'verify' | 'update'): Promise<never> {
    const body = await response.json().catch(() => null) as { code?: string; error_code?: string } | null;
    const code = body?.error_code ?? body?.code;
    if (response.status === 429) throw new HttpException('Dịch vụ Auth đang giới hạn yêu cầu. Vui lòng thử lại sau.', 429);
    if (operation === 'verify' && ['invalid_credentials', 'email_not_confirmed'].includes(code ?? '')) {
      throw new BadRequestException('Mật khẩu hiện tại không đúng hoặc tài khoản chưa thể xác thực lại.');
    }
    if (operation === 'update' && ['weak_password', 'same_password', 'validation_failed', 'reauthentication_needed', 'reauthentication_not_valid'].includes(code ?? '')) {
      throw new BadRequestException(code === 'same_password' ? 'Mật khẩu mới phải khác mật khẩu hiện tại.'
        : code?.startsWith('reauthentication') ? 'Chính sách Auth yêu cầu xác thực bổ sung. Vui lòng đăng nhập lại hoặc liên hệ ADMIN.'
          : 'Mật khẩu chưa đáp ứng chính sách Supabase. Hãy chọn mật khẩu mạnh hơn.');
    }
    if (operation === 'update' && ['insufficient_aal', 'user_sso_managed'].includes(code ?? '')) {
      throw new BadRequestException('Tài khoản yêu cầu xác thực bổ sung hoặc mật khẩu do nhà cung cấp khác quản lý. Vui lòng liên hệ ADMIN.');
    }
    if (response.status === 404 || code === 'user_not_found') throw new NotFoundException('Không tìm thấy tài khoản Auth.');
    if (operation === 'identity' && response.status === 401) throw new UnauthorizedException('Phiên đăng nhập không còn hợp lệ.');
    throw new ServiceUnavailableException('Không thể hoàn tất yêu cầu mật khẩu với Supabase Auth.');
  }

  async passwordIdentity(token: string, expectedId: string): Promise<{ email: string }> {
    const response = await this.passwordRequest('/user', token);
    if (!response.ok) return this.passwordError(response, 'identity');
    const body = await response.json().catch(() => null) as { id?: string; email?: string } | null;
    if (body?.id !== expectedId) throw new ForbiddenException('Danh tính Auth không khớp tài khoản đang đăng nhập.');
    if (!body.email) throw new BadRequestException('Tài khoản chưa có email để xác thực lại.');
    return { email: body.email };
  }

  private async passwordLogout(token: string, scope: 'global' | 'local'): Promise<boolean> {
    try { return (await this.passwordRequest(`/logout?scope=${scope}`, token, 'POST')).ok; }
    catch { return false; }
  }

  async changeOwnPassword(token: string, expectedId: string, currentPassword: string, newPassword: string) {
    const identity = await this.passwordIdentity(token, expectedId);
    const { key } = this.settings();
    const verification = await this.passwordRequest('/token?grant_type=password', key, 'POST', { email: identity.email, password: currentPassword });
    if (!verification.ok) return this.passwordError(verification, 'verify');
    const session = await verification.json().catch(() => null) as { access_token?: string; user?: { id?: string } } | null;
    if (!session?.access_token) throw new ServiceUnavailableException('Chưa xác nhận được phiên xác thực lại.');
    let changed = false;
    try {
      if (session.user?.id !== expectedId) throw new ForbiddenException('Danh tính xác thực lại không khớp tài khoản.');
      const response = await this.passwordRequest('/user', session.access_token, 'PUT', { password: newPassword, current_password: currentPassword });
      if (!response.ok) return await this.passwordError(response, 'update');
      const body = await response.json().catch(() => null) as { id?: string } | null;
      if (body?.id !== expectedId) throw new ServiceUnavailableException('Chưa xác nhận được kết quả đổi mật khẩu. Hãy kiểm tra đăng nhập trước khi thử lại.');
      changed = true;
      return { refresh_sessions_revoked: await this.passwordLogout(session.access_token, 'global') };
    } finally {
      // Clean the temporary password-grant session even on a policy rejection.
      if (!changed) await this.passwordLogout(session.access_token, 'local');
    }
  }

  async resetPassword(id: string, password: string): Promise<void> {
    const { key } = this.settings();
    const response = await this.passwordRequest(`/admin/users/${encodeURIComponent(id)}`, key, 'PUT', { password });
    if (!response.ok) return this.passwordError(response, 'update');
    const body = await response.json().catch(() => null) as { id?: string } | null;
    if (body?.id !== id) throw new ServiceUnavailableException('Chưa xác nhận được kết quả đặt lại mật khẩu. Hãy kiểm tra tài khoản trước khi thử lại.');
  }
}
