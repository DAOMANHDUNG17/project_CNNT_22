import { BadRequestException, ConflictException, HttpException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateProductUnitDto } from './create-product-unit.dto';
import { PatchProductUnitDto } from './patch-product-unit.dto';

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

  async create(dto: CreateProductUnitDto): Promise<{ data: ProductUnit }> {
    if (dto.is_base_unit && dto.conversion_factor !== 1) {
      throw new BadRequestException('Base unit conversion factor must be 1');
    }

    let product: { product_name: string; base_unit: string; is_active: boolean } | undefined;
    try {
      const rows = await this.databaseService.query(
        'SELECT product_name, base_unit, is_active FROM public.products WHERE product_id = $1',
        [dto.product_id],
      );
      product = rows[0] as unknown as typeof product;
    } catch {
      throw new InternalServerErrorException('Unable to create product unit');
    }
    if (!product) throw new NotFoundException('Product not found');
    if (!product.is_active) throw new ConflictException('Product is inactive');
    if (dto.is_base_unit && dto.unit_name.toLocaleLowerCase() !== product.base_unit.trim().toLocaleLowerCase()) {
      throw new BadRequestException('Base unit name must match the product base unit');
    }

    try {
      const conflicts = await this.databaseService.query(
        'SELECT EXISTS (SELECT 1 FROM public.product_units WHERE scan_code = $1) AS scan_code_exists, EXISTS (SELECT 1 FROM public.product_units WHERE product_id = $2 AND unit_name = $3) AS unit_name_exists, EXISTS (SELECT 1 FROM public.product_units WHERE product_id = $2 AND is_base_unit = true) AS base_unit_exists',
        [dto.scan_code, dto.product_id, dto.unit_name],
      );
      const existing = conflicts[0];
      if (existing?.scan_code_exists) throw new ConflictException('Scan code already exists');
      if (existing?.unit_name_exists) throw new ConflictException('Unit name already exists for this product');
      if (dto.is_base_unit && existing?.base_unit_exists) throw new ConflictException('Base unit already exists for this product');

      const rows = await this.databaseService.query(
        'INSERT INTO public.product_units (product_id, unit_name, conversion_factor, scan_code, is_base_unit) VALUES ($1, $2, $3, $4, $5) RETURNING product_unit_id, product_id, unit_name, conversion_factor, scan_code, is_base_unit, created_at',
        [dto.product_id, dto.unit_name, dto.conversion_factor, dto.scan_code, dto.is_base_unit],
      );
      const row = rows[0];
      if (!row) throw new Error('Product unit insert returned no row');
      return { data: {
        product_unit_id: String(row.product_unit_id),
        product_id: row.product_id as string,
        product_name: product.product_name,
        unit_name: row.unit_name as string,
        conversion_factor: row.conversion_factor as number,
        scan_code: row.scan_code as string,
        is_base_unit: row.is_base_unit as boolean,
        created_at: row.created_at as Date,
      } };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      const pg = error as { code?: string; constraint_name?: string; constraint?: string };
      if (pg.code === '23505') {
        const constraint = pg.constraint_name ?? pg.constraint;
        if (constraint === 'product_units_scan_code_key') throw new ConflictException('Scan code already exists');
        if (constraint === 'uq_product_unit') throw new ConflictException('Unit name already exists for this product');
        if (constraint === 'uq_one_base_unit_per_product') throw new ConflictException('Base unit already exists for this product');
        throw new ConflictException('Product unit already exists');
      }
      if (pg.code === '23503') throw new NotFoundException('Product not found');
      if (['23502', '23514', '22001', '22003'].includes(pg.code ?? '')) {
        throw new BadRequestException('Invalid product unit data');
      }
      throw new InternalServerErrorException('Unable to create product unit');
    }
  }

  async update(id: string, dto: PatchProductUnitDto): Promise<{ data: ProductUnit }> {
    if (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) {
      throw new BadRequestException('Invalid product unit ID');
    }
    if (!dto || (dto.unit_name === undefined && dto.scan_code === undefined && dto.conversion_factor === undefined)) {
      throw new BadRequestException('At least one field is required');
    }

    try {
      return await this.databaseService.transaction(async (query) => {
        const lookup = await query('SELECT product_id FROM public.product_units WHERE product_unit_id = $1', [id]);
        if (!lookup[0]) throw new NotFoundException('Product unit not found');
        const productId = lookup[0].product_id as string;

        // Stock Movement must lock products -> inventory -> product_units before writing transactions.
        // The unit FOR UPDATE lock blocks a concurrent transaction INSERT's FK KEY SHARE check.
        const products = await query('SELECT product_name, base_unit FROM public.products WHERE product_id = $1 FOR UPDATE', [productId]);
        if (!products[0]) throw new ConflictException('Product record missing');
        const inventory = dto.conversion_factor === undefined ? undefined :
          (await query('SELECT quantity_base FROM public.inventory WHERE product_id = $1 FOR UPDATE', [productId]))[0];
        const units = await query(
          'SELECT product_unit_id, product_id, unit_name, conversion_factor, scan_code, is_base_unit, created_at FROM public.product_units WHERE product_unit_id = $1 FOR UPDATE',
          [id],
        );
        const current = units[0];
        if (!current) throw new NotFoundException('Product unit not found');
        if (current.product_id !== productId) throw new ConflictException('Product unit changed; retry');

        const currentName = current.unit_name as string;
        const productBaseUnit = products[0].base_unit as string;
        const requestedName = dto.unit_name;
        const sameName = current.is_base_unit
          ? requestedName === currentName.trim() && currentName === productBaseUnit
          : requestedName?.toLocaleLowerCase() === currentName.trim().toLocaleLowerCase();
        const nextName = requestedName === undefined || sameName ? currentName : requestedName;
        const nextCode = dto.scan_code ?? current.scan_code as string;
        const nextFactor = dto.conversion_factor ?? current.conversion_factor as number;
        const factorChanged = nextFactor !== current.conversion_factor;
        const productBaseChanged = current.is_base_unit === true && nextName !== productBaseUnit;
        const unitChanged = nextName !== currentName || nextCode !== current.scan_code || factorChanged;

        if (current.is_base_unit && currentName.trim().toLocaleLowerCase() !==
          productBaseUnit.trim().toLocaleLowerCase()) {
          throw new ConflictException('Tên đơn vị cơ sở hiện không khớp với sản phẩm. Cần kiểm tra dữ liệu trước khi chỉnh sửa.');
        }
        if (current.is_base_unit && currentName !== productBaseUnit && requestedName === undefined) {
          throw new ConflictException('Tên đơn vị cơ sở chưa thống nhất. Vui lòng nhập tên đơn vị để đồng bộ.');
        }

        if (factorChanged) {
          if (current.is_base_unit) throw new ConflictException('Cannot change the base unit conversion factor');
          if (!inventory) throw new ConflictException('Inventory record missing');
          const history = await query(
            'SELECT EXISTS (SELECT 1 FROM public.stock_transactions WHERE product_unit_id = $1) AS has_transactions',
            [id],
          );
          if (history[0]?.has_transactions) {
            throw new ConflictException('Không thể thay đổi hệ số quy đổi vì đơn vị này đã phát sinh giao dịch nhập/xuất.');
          }
          if (BigInt(String(inventory.quantity_base)) > 0n) {
            throw new ConflictException('Không thể thay đổi hệ số quy đổi khi sản phẩm vẫn còn tồn kho.');
          }
        }

        if (!unitChanged && !productBaseChanged) {
          return { data: this.toUnit(current, products[0].product_name as string) };
        }
        const conflicts = await query(
          'SELECT EXISTS (SELECT 1 FROM public.product_units WHERE product_id = $1 AND unit_name = $2 AND product_unit_id <> $3) AS unit_name_exists, EXISTS (SELECT 1 FROM public.product_units WHERE scan_code = $4 AND product_unit_id <> $3) AS scan_code_exists',
          [productId, nextName, id, nextCode],
        );
        if (conflicts[0]?.unit_name_exists) throw new ConflictException('Unit name already exists for this product');
        if (conflicts[0]?.scan_code_exists) throw new ConflictException('Scan code already exists');

        if (productBaseChanged) {
          const productUpdate = await query(
            'UPDATE public.products SET base_unit = $2 WHERE product_id = $1 RETURNING base_unit',
            [productId, nextName],
          );
          if (productUpdate[0]?.base_unit !== nextName) throw new Error('Product base unit update returned an unexpected value');
        }
        let changed = current;
        if (unitChanged) {
          const changedRows = await query(
            'UPDATE public.product_units SET unit_name = $2, scan_code = $3, conversion_factor = $4 WHERE product_unit_id = $1 RETURNING product_unit_id, product_id, unit_name, conversion_factor, scan_code, is_base_unit, created_at',
            [id, nextName, nextCode, nextFactor],
          );
          if (!changedRows[0]) throw new Error('Product unit update returned no row');
          changed = changedRows[0];
        }
        if (current.is_base_unit && changed.unit_name !== nextName) {
          throw new Error('Base unit update returned an unexpected name');
        }
        return { data: this.toUnit(changed, products[0].product_name as string) };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const pg = error as { code?: string; constraint_name?: string; constraint?: string };
      if (pg.code === '23505') {
        const constraint = pg.constraint_name ?? pg.constraint;
        if (constraint === 'product_units_scan_code_key') throw new ConflictException('Scan code already exists');
        if (constraint === 'uq_product_unit') throw new ConflictException('Unit name already exists for this product');
        throw new ConflictException('Product unit already exists');
      }
      if (['23514', '23502', '22001', '22003'].includes(pg.code ?? '')) {
        throw new BadRequestException('Invalid product unit data');
      }
      throw new InternalServerErrorException('Unable to update product unit');
    }
  }

  private toUnit(row: Record<string, unknown>, productName: string): ProductUnit {
    return {
      product_unit_id: String(row.product_unit_id),
      product_id: row.product_id as string,
      product_name: productName,
      unit_name: row.unit_name as string,
      conversion_factor: row.conversion_factor as number,
      scan_code: row.scan_code as string,
      is_base_unit: row.is_base_unit as boolean,
      created_at: row.created_at as Date,
    };
  }
}
