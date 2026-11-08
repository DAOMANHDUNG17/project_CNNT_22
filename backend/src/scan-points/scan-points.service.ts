import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface ScanPoint {
  scan_point_id: string;
  point_name: string;
  is_active: boolean;
  created_at: Date;
}

@Injectable()
export class ScanPointsService {
  constructor(private readonly databaseService: DatabaseService) {}

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
