import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface InventoryItem {
  product_id: string;
  product_name: string;
  base_unit: string;
  is_active: boolean;
  quantity_base: string;
  updated_at: Date;
}

@Injectable()
export class InventoryService {
  constructor(private readonly databaseService: DatabaseService) {}

  async findAll(): Promise<{ data: InventoryItem[]; count: number }> {
    const rows = await this.databaseService.query(
      'SELECT i.product_id, p.product_name, p.base_unit, p.is_active, i.quantity_base, i.updated_at FROM public.inventory AS i JOIN public.products AS p ON p.product_id = i.product_id ORDER BY i.product_id',
    );
    const data = rows.map((row) => ({
      product_id: row.product_id as string,
      product_name: row.product_name as string,
      base_unit: row.base_unit as string,
      is_active: row.is_active as boolean,
      quantity_base: String(row.quantity_base),
      updated_at: row.updated_at as Date,
    }));
    return { data, count: data.length };
  }
}
