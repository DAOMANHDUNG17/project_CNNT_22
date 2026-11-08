import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface ProductUnit {
  product_unit_id: string;
  product_id: string;
  product_name: string;
  unit_name: string;
  conversion_factor: number;
  scan_code: string;
  is_base_unit: boolean;
  created_at: Date;
}

@Injectable()
export class ProductUnitsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async findAll(): Promise<{ data: ProductUnit[]; count: number }> {
    const rows = await this.databaseService.query(
      'SELECT u.product_unit_id, u.product_id, p.product_name, u.unit_name, u.conversion_factor, u.scan_code, u.is_base_unit, u.created_at FROM public.product_units AS u JOIN public.products AS p ON p.product_id = u.product_id ORDER BY u.product_id, u.is_base_unit DESC, u.product_unit_id',
    );
    const data = rows.map((row) => ({
      product_unit_id: String(row.product_unit_id),
      product_id: row.product_id as string,
      product_name: row.product_name as string,
      unit_name: row.unit_name as string,
      conversion_factor: row.conversion_factor as number,
      scan_code: row.scan_code as string,
      is_base_unit: row.is_base_unit as boolean,
      created_at: row.created_at as Date,
    }));
    return { data, count: data.length };
  }
}
