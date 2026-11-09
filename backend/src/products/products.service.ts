import { BadRequestException, ConflictException, HttpException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateProductDto } from './create-product.dto';
import { PatchProductDto } from './patch-product.dto';

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

  async create(dto: CreateProductDto): Promise<{ data: Product }> {
    try {
      const rows = await this.databaseService.query(
        'INSERT INTO public.products (product_id, product_name, base_unit) VALUES ($1, $2, $3) RETURNING product_id, product_name, base_unit, is_active, created_at, updated_at',
        [dto.product_id, dto.product_name, dto.base_unit],
      );
      const row = rows[0];
      if (!row) throw new Error('Product insert returned no row');
      return { data: {
        product_id: row.product_id as string,
        product_name: row.product_name as string,
        base_unit: row.base_unit as string,
        is_active: row.is_active as boolean,
        created_at: row.created_at as Date,
        updated_at: row.updated_at as Date,
      } };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Product ID already exists');
      }
      throw new InternalServerErrorException('Unable to create product');
    }
  }

  async update(id: string, dto: PatchProductDto): Promise<{ data: Product }> {
    if (!dto || (dto.product_name === undefined && dto.is_active === undefined)) {
      throw new BadRequestException('At least one field is required');
    }

    try {
      return await this.databaseService.transaction(async (query) => {
        // Stock Movement must lock products before inventory in this same order.
        const currentRows = await query(
          'SELECT product_id, product_name, base_unit, is_active, created_at, updated_at FROM public.products WHERE product_id = $1 FOR UPDATE',
          [id],
        );
        const current = currentRows[0];
        if (!current) throw new NotFoundException('Product not found');

        const nextName = dto.product_name ?? current.product_name as string;
        const nextActive = dto.is_active ?? current.is_active as boolean;
        if (nextActive !== current.is_active) {
          const inventoryRows = await query(
            'SELECT quantity_base FROM public.inventory WHERE product_id = $1 FOR UPDATE',
            [id],
          );
          const inventory = inventoryRows[0];
          if (!inventory) throw new ConflictException('Inventory record missing');
          if (!nextActive && BigInt(String(inventory.quantity_base)) > 0n) {
            throw new ConflictException('Không thể ngừng hoạt động sản phẩm khi vẫn còn tồn kho.');
          }
        }

        if (nextName === current.product_name && nextActive === current.is_active) {
          return { data: this.toProduct(current) };
        }
        const changedRows = await query(
          'UPDATE public.products SET product_name = $2, is_active = $3 WHERE product_id = $1 RETURNING product_id, product_name, base_unit, is_active, created_at, updated_at',
          [id, nextName, nextActive],
        );
        const changed = changedRows[0];
        if (!changed) throw new Error('Product update returned no row');
        return { data: this.toProduct(changed) };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if ((error as { code?: string }).code === '22001') {
        throw new BadRequestException('Invalid product data');
      }
      throw new InternalServerErrorException('Unable to update product');
    }
  }

  private toProduct(row: Record<string, unknown>): Product {
    return {
      product_id: row.product_id as string,
      product_name: row.product_name as string,
      base_unit: row.base_unit as string,
      is_active: row.is_active as boolean,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }
}
