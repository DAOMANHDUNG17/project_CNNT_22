import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, InternalServerErrorException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { BusinessUser } from '../auth/auth.types';
import { SupabaseAdminService } from './supabase-admin.service';
import { CreateUserDto, PatchUserDto, UsersQueryDto } from './users.dto';

const columns = 'u.user_id::text, u.auth_user_id, u.username, u.display_name, a.email, u.role, u.is_active, u.created_at, u.updated_at';
type Query = Parameters<Parameters<DatabaseService['transaction']>[0]>[0];

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(private readonly database: DatabaseService, private readonly auth: SupabaseAdminService) {}

  async findAll(dto: UsersQueryDto) {
    const params: (string | number | boolean)[] = [];
    const where: string[] = [];
    if (dto.q) {
      params.push(dto.q);
      where.push(`(strpos(lower(u.username), lower($${params.length})) > 0 OR strpos(lower(u.display_name), lower($${params.length})) > 0 OR strpos(lower(a.email), lower($${params.length})) > 0)`);
    }
    if (dto.role !== undefined) { params.push(dto.role); where.push(`u.role = $${params.length}`); }
    if (dto.isActive !== undefined) { params.push(dto.isActive); where.push(`u.is_active = $${params.length}`); }
    params.push(dto.limit, ((BigInt(dto.page) - 1n) * BigInt(dto.limit)).toString());
    try {
      const rows = await this.database.query(`WITH filtered AS MATERIALIZED (
        SELECT ${columns} FROM public.users u LEFT JOIN auth.users a ON a.id = u.auth_user_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''})
        SELECT p.*, totals.total FROM (SELECT count(*)::text AS total FROM filtered) totals
        LEFT JOIN LATERAL (SELECT * FROM filtered ORDER BY created_at DESC, user_id::bigint DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}) p ON true
        ORDER BY p.created_at DESC, p.user_id::bigint DESC`, params);
      const total = Number(rows[0]?.total ?? 0);
      if (!Number.isSafeInteger(total)) throw new Error('Unsafe count');
      return { data: rows.filter(row => row.user_id != null).map(({ total: _total, ...row }) => row), count: total,
        pagination: { page: dto.page, limit: dto.limit, total, totalPages: Math.ceil(total / dto.limit) } };
    } catch { throw new ServiceUnavailableException('Không tải được danh sách người dùng.'); }
  }

  private async lockAdmin(query: Query, actor: BusinessUser) {
    // Serialize all user administration, including the last active ADMIN check.
    await query('SELECT pg_advisory_xact_lock(22110011)');
    const rows = await query('SELECT role, is_active FROM public.users WHERE user_id = $1 AND auth_user_id = $2 FOR UPDATE', [String(actor.user_id), actor.auth_user_id]);
    if (rows[0]?.role !== 'ADMIN' || rows[0]?.is_active !== true) throw new ForbiddenException();
  }

  private validateUserId(id: string) {
    if (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) throw new BadRequestException('Mã người dùng không hợp lệ.');
  }

  private async readScanPointAccess(query: Query, id: string) {
    const rows = await query(`SELECT u.user_id::text, a.scan_point_id, s.point_name,
      a.is_active, s.is_active AS scan_point_is_active, a.assigned_by::text, a.assigned_at
      FROM public.users u LEFT JOIN public.user_scan_point_access a ON a.user_id = u.user_id
      LEFT JOIN public.scan_points s ON s.scan_point_id = a.scan_point_id
      WHERE u.user_id = $1 ORDER BY a.scan_point_id`, [id]);
    if (!rows.length) throw new NotFoundException('Không tìm thấy người dùng.');
    const data = rows.filter(row => row.scan_point_id != null);
    return { data, count: data.length };
  }

  async getScanPointAccess(id: string) {
    this.validateUserId(id);
    try { return await this.readScanPointAccess((text, params) => this.database.query(text, params), id); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Không tải được quyền sử dụng điểm quét.');
    }
  }

  async replaceScanPointAccess(id: string, selectedIds: string[], actor: BusinessUser) {
    this.validateUserId(id);
    try {
      return await this.database.transaction(async query => {
        await this.lockAdmin(query, actor);
        const users = await query('SELECT user_id, role FROM public.users WHERE user_id = $1 FOR UPDATE', [id]);
        if (!users[0]) throw new NotFoundException('Không tìm thấy người dùng.');
        if (users[0].role === 'STAFF' && selectedIds.length > 1) throw new BadRequestException('STAFF chỉ được phân công tối đa một điểm quét active.');
        if (selectedIds.length) {
          const points = await query(`SELECT scan_point_id, is_active FROM public.scan_points
            WHERE scan_point_id IN (${selectedIds.map((_, index) => `$${index + 1}`).join(', ')})
            ORDER BY scan_point_id FOR SHARE`, selectedIds);
          if (points.length !== selectedIds.length) throw new NotFoundException('Điểm quét không tồn tại.');
          if (points.some(point => point.is_active !== true)) throw new BadRequestException('Không thể cấp quyền cho điểm quét đã ngừng hoạt động.');
        }
        const params = [id, String(actor.user_id), ...selectedIds];
        const selected = selectedIds.map((_, index) => `$${index + 3}`);
        await query(`UPDATE public.user_scan_point_access SET is_active = false, assigned_by = $2, assigned_at = now()
          WHERE user_id = $1 AND is_active = true${selected.length ? ` AND scan_point_id NOT IN (${selected.join(', ')})` : ''}`, params);
        if (selected.length) {
          await query(`INSERT INTO public.user_scan_point_access (user_id, scan_point_id, is_active, assigned_by, assigned_at)
            VALUES ${selected.map(placeholder => `($1, ${placeholder}, true, $2, now())`).join(', ')}
            ON CONFLICT (user_id, scan_point_id) DO UPDATE SET is_active = true,
              assigned_by = EXCLUDED.assigned_by, assigned_at = EXCLUDED.assigned_at
            WHERE user_scan_point_access.is_active = false`, params);
        }
        return this.readScanPointAccess(query, id);
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Không lưu được quyền điểm quét. Tải lại quyền trước khi thử lại.');
    }
  }

  async create(dto: CreateUserDto, actor: BusinessUser) {
    let authId: string | undefined;
    try {
      const data = await this.database.transaction(async query => {
        await this.lockAdmin(query, actor);
        const duplicate = await query(`SELECT EXISTS(SELECT 1 FROM public.users WHERE username = $1) AS username_exists,
          EXISTS(SELECT 1 FROM auth.users WHERE lower(email) = lower($2)) AS email_exists`, [dto.username, dto.email]);
        if (duplicate[0]?.email_exists) throw new ConflictException('Email đã được sử dụng.');
        if (duplicate[0]?.username_exists) throw new ConflictException('Tên đăng nhập đã được sử dụng.');
        authId = await this.auth.create(dto.email, dto.password);
        const rows = await query(`INSERT INTO public.users (auth_user_id, username, display_name, role, is_active)
          VALUES ($1, $2, $3, $4, $5) RETURNING user_id::text, auth_user_id, username, display_name, role, is_active, created_at, updated_at`,
        [authId, dto.username, dto.display_name, dto.role, dto.is_active ?? true]);
        if (!rows[0]) throw new Error('Missing created user');
        return Object.assign({}, rows[0], { email: dto.email });
      });
      return { data };
    } catch (error) {
      if (authId) {
        // A lost COMMIT acknowledgement must never delete an Auth identity linked to a committed profile.
        let linked;
        try { linked = await this.database.query(`SELECT ${columns} FROM public.users u LEFT JOIN auth.users a ON a.id = u.auth_user_id WHERE u.auth_user_id = $1`, [authId]); }
        catch {
          this.logger.error(`User provisioning requires reconciliation for Auth UUID ${authId}; commit status unknown`);
          throw new ServiceUnavailableException('Chưa xác định kết quả tạo tài khoản. Kiểm tra lại danh sách.');
        }
        if (linked[0]) return { data: linked[0] };
        try { await this.auth.remove(authId); }
        catch { this.logger.error(`Auth compensation failed for UUID ${authId}; manual reconciliation required`); }
      }
      this.rethrow(error);
    }
  }

  async update(id: string, dto: PatchUserDto, actor: BusinessUser) {
    if (BigInt(id) > 9223372036854775807n) throw new BadRequestException('Mã người dùng không hợp lệ.');
    const entries = (['username', 'display_name', 'role', 'is_active'] as const)
      .filter(key => dto[key] !== undefined).map(key => [key, dto[key]] as const);
    if (!entries.length) throw new BadRequestException('Cần ít nhất một trường cập nhật.');
    try {
      return await this.database.transaction(async query => {
        await this.lockAdmin(query, actor);
        const rows = await query('SELECT user_id, role, is_active FROM public.users WHERE user_id = $1 FOR UPDATE', [id]);
        const target = rows[0];
        if (!target) throw new NotFoundException('Không tìm thấy người dùng.');
        if (target.role === 'ADMIN' && target.is_active === true && (dto.is_active === false || (dto.role !== undefined && dto.role !== 'ADMIN'))) {
          const admins = await query("SELECT count(*)::text AS count FROM public.users WHERE role = 'ADMIN' AND is_active = true");
          if (BigInt(admins[0].count as string) <= 1n) throw new ConflictException('Phải giữ ít nhất một ADMIN hoạt động.');
        }
        if (dto.role === 'STAFF') {
          const grants = await query('SELECT count(*)::text AS count FROM public.user_scan_point_access WHERE user_id = $1 AND is_active = true', [id]);
          if (BigInt(grants[0].count as string) > 1n) throw new ConflictException('Thu hồi bớt quyền điểm quét trước khi chuyển người dùng sang STAFF.');
        }
        const params: (string | boolean)[] = entries.map(([, value]) => value as string | boolean);
        params.push(id);
        await query(`UPDATE public.users SET ${entries.map(([key], index) => `${key} = $${index + 1}`).join(', ')}, updated_at = now() WHERE user_id = $${params.length}`, params);
        const updated = await query(`SELECT ${columns} FROM public.users u LEFT JOIN auth.users a ON a.id = u.auth_user_id WHERE u.user_id = $1`, [id]);
        return { data: updated[0] };
      });
    } catch (error) { this.rethrow(error); }
  }

  private rethrow(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if ((error as { code?: string })?.code === '23505') throw new ConflictException('Tên đăng nhập hoặc email đã được sử dụng.');
    throw new InternalServerErrorException('Không thể lưu người dùng.');
  }
}
