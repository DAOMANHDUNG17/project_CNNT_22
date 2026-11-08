import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface Product {
  product_id: string;
  product_name: string;
  base_unit: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class ProductsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async findAll(): Promise<{ data: Product[]; count: number }> {
    const rows = await this.databaseService.query(
      'SELECT product_id, product_name, base_unit, is_active, created_at, updated_at FROM public.products ORDER BY product_id',
    );
    const data = rows.map((row) => ({
      product_id: row.product_id as string,
      product_name: row.product_name as string,
      base_unit: row.base_unit as string,
      is_active: row.is_active as boolean,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    }));
    return { data, count: data.length };
  }
}
