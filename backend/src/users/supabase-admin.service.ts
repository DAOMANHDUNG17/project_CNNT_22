import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SupabaseAdminService {
  private readonly logger = new Logger(SupabaseAdminService.name);
  constructor(private readonly config: ConfigService) {}

  private settings() {
    const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    const url = this.config.get<string>('SUPABASE_URL');
    if (!key?.trim() || !url || new URL(url).protocol !== 'https:') {
      throw new ServiceUnavailableException('Chưa cấu hình dịch vụ quản trị tài khoản.');
    }
    return { url: url.replace(/\/$/, ''), key };
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
}
