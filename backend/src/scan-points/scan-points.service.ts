import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ForbiddenException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import type { BusinessUser } from '../auth/auth.types';

export interface ScanPoint {
  scan_point_id: string;
  point_name: string;
  is_active: boolean;
  created_at: Date;
}

@Injectable()
export class ScanPointsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async findMine(user: BusinessUser): Promise<{ data: ScanPoint[]; count: number }> {
    try {
      const rows = await this.databaseService.query(`WITH account AS (
        SELECT user_id, role FROM public.users u WHERE u.user_id = $1 AND u.auth_user_id = $2
          AND u.is_active = true AND u.role IN ('ADMIN', 'STAFF')
        ), grants AS MATERIALIZED (
          SELECT s.scan_point_id, s.point_name, s.is_active, s.created_at FROM public.user_scan_point_access a
          JOIN public.scan_points s ON s.scan_point_id = a.scan_point_id WHERE a.user_id = $1 AND a.is_active = true
        ) SELECT s.*, account.role AS current_role, (SELECT count(*)::text FROM grants) AS active_grant_count
          FROM account LEFT JOIN grants s ON s.is_active = true ORDER BY s.scan_point_id`, [String(user.user_id), user.auth_user_id]);
      if (rows[0]?.current_role === 'STAFF' && BigInt(rows[0].active_grant_count as string) > 1n) throw new ForbiddenException('Tài khoản có nhiều điểm quét active. Liên hệ ADMIN để xử lý phân công.');
      const data = rows.filter(row => row.scan_point_id != null).map(row => ({ scan_point_id: row.scan_point_id as string, point_name: row.point_name as string,
        is_active: row.is_active as boolean, created_at: row.created_at as Date }));
      return { data, count: data.length };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Không tải được điểm quét đã cấp quyền.');
    }
  }

  async findAll(): Promise<{ data: ScanPoint[]; count: number }> {
    const rows = await this.databaseService.query(
      'SELECT scan_point_id, point_name, is_active, created_at FROM public.scan_points ORDER BY scan_point_id',
    );
    const data = rows.map((row) => ({
      scan_point_id: row.scan_point_id as string,
      point_name: row.point_name as string,
      is_active: row.is_active as boolean,
      created_at: row.created_at as Date,
    }));
    return { data, count: data.length };
  }
}
