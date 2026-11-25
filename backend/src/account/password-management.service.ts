import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { BusinessUser } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import { SupabaseAdminService } from '../users/supabase-admin.service';
import { PasswordAttemptsService } from './password-attempts.service';
import { ChangePasswordDto, ResetPasswordDto } from './password.dto';

@Injectable()
export class PasswordManagementService {
  private readonly logger = new Logger(PasswordManagementService.name);
  constructor(private readonly database: DatabaseService, private readonly auth: SupabaseAdminService,
    private readonly attempts: PasswordAttemptsService) {}

  async profile(actor: BusinessUser, token: string) {
    const identity = await this.auth.passwordIdentity(token, actor.auth_user_id);
    return { user_id: String(actor.user_id), username: actor.username, display_name: actor.display_name,
      role: actor.role, email: identity.email };
  }

  private validate(dto: ResetPasswordDto) {
    if (dto.new_password !== dto.confirm_password) throw new BadRequestException('Xác nhận mật khẩu mới không khớp.');
  }

  private audit(actor: BusinessUser, target: string, result: string) {
    this.logger.log(JSON.stringify({ actor: String(actor.user_id), target, time: new Date().toISOString(), result }));
  }

  async change(actor: BusinessUser, token: string, dto: ChangePasswordDto) {
    return this.attempts.run(String(actor.user_id), async () => {
      try {
        this.validate(dto);
        if (dto.new_password === dto.current_password) throw new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại.');
        const result = await this.auth.changeOwnPassword(token, actor.auth_user_id, dto.current_password, dto.new_password);
        this.audit(actor, String(actor.user_id), result.refresh_sessions_revoked ? 'changed_logout_acknowledged' : 'changed_logout_unconfirmed');
        return { changed: true, requires_relogin: true, ...result };
      } catch (error) { this.audit(actor, String(actor.user_id), 'failed_or_unconfirmed'); this.failure(error); }
    });
  }

  async reset(actor: BusinessUser, id: string, dto: ResetPasswordDto) {
    if (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) throw new BadRequestException('Mã người dùng không hợp lệ.');
    return this.attempts.run(String(actor.user_id), async () => {
      try {
        this.validate(dto);
        if (id === String(actor.user_id)) throw new BadRequestException('Hãy đổi mật khẩu của bạn trong Cài đặt tài khoản.');
        // Same admin advisory lock as existing account management. Only SELECTs;
        // do not update the business profile, role, assignments or Auth SQL tables.
        return await this.database.transaction(async query => {
          await query('SELECT pg_advisory_xact_lock(22110011)');
          const [current] = await query('SELECT role, is_active FROM public.users WHERE user_id = $1 AND auth_user_id = $2 FOR UPDATE', [String(actor.user_id), actor.auth_user_id]);
          if (!current?.is_active || current.role !== 'ADMIN') throw new ForbiddenException('Chỉ ADMIN đang hoạt động được đặt lại mật khẩu.');
          const [target] = await query('SELECT auth_user_id FROM public.users WHERE user_id = $1 FOR UPDATE', [id]);
          if (!target) throw new NotFoundException('Không tìm thấy tài khoản đích.');
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target.auth_user_id ?? '')) {
            throw new ServiceUnavailableException('Tài khoản đích chưa liên kết danh tính Auth hợp lệ.');
          }
          await this.auth.resetPassword(target.auth_user_id, dto.new_password);
          this.audit(actor, id, 'reset');
          return { changed: true, requires_relogin: false, refresh_sessions_revoked: false };
        });
      } catch (error) { this.audit(actor, id, 'failed_or_unconfirmed'); this.failure(error); }
    });
  }

  private failure(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException('Chưa xác định được kết quả cập nhật mật khẩu. Kiểm tra đăng nhập trước khi thử lại.');
  }
}
