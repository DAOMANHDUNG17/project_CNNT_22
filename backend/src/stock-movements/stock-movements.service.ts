import { ConflictException, ForbiddenException, HttpException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import type { BusinessUser } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import { CreateStockMovementDto } from './create-stock-movement.dto';

const maxBigint = 9223372036854775807n;
type Row = Record<string, unknown>;
type Query = Parameters<Parameters<DatabaseService['transaction']>[0]>[0];

export interface StockMovement {
  transaction_id: string;
  product_id: string;
  product_name: string;
  product_unit_id: string;
  unit_name: string;
  scan_code_snapshot: string;
  scan_point_id: string;
  user_id: string;
  movement_type: 'IN' | 'OUT';
  quantity_packages: number;
  conversion_factor_snapshot: number;
  quantity_base: string;
  inventory_before: string;
  inventory_after: string;
  created_at: Date;
}

@Injectable()
export class StockMovementsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async create(dto: CreateStockMovementDto, actor: BusinessUser): Promise<{ data: StockMovement; replay: boolean }> {
    // PostgreSQL UUID equality is case-insensitive; use one identity for locks and storage.
    const transactionId = dto.transaction_id.toLowerCase();
    try {
      return await this.databaseService.transaction(async (query) => {
        // Serialize attempts sharing a UUID before any inventory lock or write.
        // A hash collision only serializes unrelated requests; the UUID PK remains authoritative.
        await query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [transactionId]);
        const pointId = await this.assignedPoint(query, dto, actor);
        const replayed = await query(this.historySql(), [transactionId]);
        if (replayed[0]) return this.replay(replayed[0], dto, actor, pointId);

        // This lookup only locates the product. Recheck the unit after acquiring locks.
        const lookup = await query('SELECT product_id, product_unit_id FROM public.product_units WHERE scan_code = $1', [dto.scan_code]);
        if (!lookup[0]) {
          const committed = await query(this.historySql(), [transactionId]);
          if (committed[0]) return this.replay(committed[0], dto, actor, pointId);
          throw new NotFoundException('Không tìm thấy mã quét.');
        }
        const productId = lookup[0].product_id as string;

        // Stock Movement and PATCH APIs share this order: products -> inventory -> product_units.
        const products = await query('SELECT product_id, product_name, is_active FROM public.products WHERE product_id = $1 FOR UPDATE', [productId]);
        if (!products[0]) throw new ConflictException('Dữ liệu sản phẩm không còn nhất quán.');
        const inventory = await query('SELECT quantity_base FROM public.inventory WHERE product_id = $1 FOR UPDATE', [productId]);
        if (!inventory[0]) throw new ConflictException('Không tìm thấy bản ghi tồn kho của sản phẩm.');
        const units = await query('SELECT product_unit_id, product_id, unit_name, scan_code, conversion_factor FROM public.product_units WHERE product_unit_id = $1 FOR UPDATE', [String(lookup[0].product_unit_id)]);
        const unit = units[0];
        // A concurrent request for the same product may have committed while we waited.
        const committed = await query(this.historySql(), [transactionId]);
        if (committed[0]) return this.replay(committed[0], dto, actor, pointId);

        if (!unit || unit.product_id !== productId || unit.scan_code !== dto.scan_code) {
          throw new ConflictException('Mã quét đã thay đổi. Vui lòng quét lại.');
        }

        if (products[0].is_active !== true) throw new ConflictException('Sản phẩm đã ngừng hoạt động.');
        const factor = unit.conversion_factor as number;
        if (!Number.isInteger(factor) || factor < 1) throw new ConflictException('Hệ số quy đổi không hợp lệ.');

        const before = BigInt(String(inventory[0].quantity_base));
        const amount = BigInt(factor) * BigInt(dto.quantity_packages);
        if (before < 0n || before > maxBigint) throw new ConflictException('Số lượng tồn kho vượt giới hạn cho phép.');
        if (dto.movement_type === 'OUT' && before < amount) {
          throw new ConflictException('Không đủ tồn kho để xuất.');
        }
        const after = dto.movement_type === 'IN' ? before + amount : before - amount;
        if (after > maxBigint) throw new ConflictException('Số lượng tồn kho vượt giới hạn cho phép.');

        const updated = await query('UPDATE public.inventory SET quantity_base = $2 WHERE product_id = $1 RETURNING quantity_base', [productId, after.toString()]);
        if (String(updated[0]?.quantity_base) !== after.toString()) throw new Error('Inventory update returned an unexpected value');
        const inserted = await query(
          'INSERT INTO public.stock_transactions (transaction_id, product_id, product_unit_id, scan_point_id, user_id, movement_type, quantity_packages, conversion_factor_snapshot, inventory_before, inventory_after, scan_code_snapshot) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING transaction_id, product_id, product_unit_id, scan_point_id, user_id, movement_type, quantity_packages, conversion_factor_snapshot, quantity_base, inventory_before, inventory_after, scan_code_snapshot, created_at',
          [transactionId, productId, String(unit.product_unit_id), pointId, String(actor.user_id), dto.movement_type, dto.quantity_packages, factor, before.toString(), after.toString(), dto.scan_code],
        );
        if (!inserted[0]) throw new Error('Stock transaction insert returned no row');
        return { data: this.toMovement(inserted[0], products[0].product_name as string, unit.unit_name as string), replay: false };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        // A uniqueness fallback must reauthorize under locks just like the normal retry path.
        try {
          return await this.databaseService.transaction(async query => {
            await query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [transactionId]);
            const pointId = await this.assignedPoint(query, dto, actor);
            const rows = await query(this.historySql(), [transactionId]);
            if (!rows[0]) throw new ConflictException('Giao dịch đã tồn tại.');
            return this.replay(rows[0], dto, actor, pointId);
          });
        } catch (retryError) {
          if (retryError instanceof HttpException) throw retryError;
          throw new InternalServerErrorException('Không thể kiểm tra giao dịch kho.');
        }
      }
      if (error instanceof HttpException) throw error;
      if (['22003', '23514'].includes((error as { code?: string }).code ?? '')) {
        throw new ConflictException('Số lượng tồn kho hoặc dữ liệu giao dịch không hợp lệ.');
      }
      throw new InternalServerErrorException('Không thể hoàn tất nhập/xuất kho.');
    }
  }

  private historySql(): string {
    return 'SELECT t.transaction_id, t.product_id, p.product_name, t.product_unit_id, u.unit_name, t.scan_point_id, t.user_id, t.movement_type, t.quantity_packages, t.conversion_factor_snapshot, t.quantity_base, t.inventory_before, t.inventory_after, t.scan_code_snapshot, t.created_at FROM public.stock_transactions AS t JOIN public.products AS p ON p.product_id = t.product_id JOIN public.product_units AS u ON u.product_unit_id = t.product_unit_id WHERE t.transaction_id = $1';
  }

  private async assignedPoint(query: Query, dto: CreateStockMovementDto, actor: BusinessUser): Promise<string> {
    // Lock the account before grants and inventory. ADMIN reassignment locks the same user FOR UPDATE,
    // so a movement commits entirely before or after a reassignment, including UUID retries.
    const users = await query('SELECT role, is_active FROM public.users WHERE user_id = $1 AND auth_user_id = $2 FOR SHARE', [String(actor.user_id), actor.auth_user_id]);
    const user = users[0];
    if (!user || user.is_active !== true || !['ADMIN', 'STAFF'].includes(user.role as string)) throw new ForbiddenException('Tài khoản không còn quyền nhập/xuất kho.');
    const grants = await query('SELECT scan_point_id FROM public.user_scan_point_access WHERE user_id = $1 AND is_active = true ORDER BY scan_point_id FOR SHARE', [String(actor.user_id)]);
    if (!grants.length) throw new ForbiddenException('Chưa được phân công điểm quét. Liên hệ ADMIN.');
    if (user.role === 'STAFF' && grants.length !== 1) throw new ForbiddenException('Tài khoản có nhiều điểm quét active. Liên hệ ADMIN để xử lý phân công.');
    const grant = dto.scan_point_id === undefined ? (grants.length === 1 ? grants[0] : undefined) : grants.find(row => row.scan_point_id === dto.scan_point_id);
    if (!grant) throw new ForbiddenException('Điểm quét không thuộc phân công hiện tại của tài khoản.');
    const pointId = grant.scan_point_id as string;
    const points = await query('SELECT is_active FROM public.scan_points WHERE scan_point_id = $1 FOR SHARE', [pointId]);
    if (!points[0] || points[0].is_active !== true) throw new ForbiddenException('Điểm quét được phân công đã ngừng hoạt động.');
    return pointId;
  }

  private replay(row: Row, dto: CreateStockMovementDto, actor: BusinessUser, pointId: string): { data: StockMovement; replay: true } {
    if (row.scan_code_snapshot !== dto.scan_code || (dto.scan_point_id !== undefined && row.scan_point_id !== dto.scan_point_id) ||
      row.movement_type !== dto.movement_type || row.quantity_packages !== dto.quantity_packages ||
      String(row.user_id) !== String(actor.user_id)) {
      throw new ConflictException('Mã giao dịch đã được dùng cho một lượt nhập/xuất khác.');
    }
    if (row.scan_point_id !== pointId) throw new ForbiddenException('Điểm quét của giao dịch cũ không còn thuộc phân công hiện tại. Không thay đổi UUID hoặc nội dung để thử lại.');
    return { data: this.toMovement(row, row.product_name as string, row.unit_name as string), replay: true };
  }

  private toMovement(row: Row, productName: string, unitName: string): StockMovement {
    return {
      transaction_id: String(row.transaction_id),
      product_id: row.product_id as string,
      product_name: productName,
      product_unit_id: String(row.product_unit_id),
      unit_name: unitName,
      scan_code_snapshot: row.scan_code_snapshot as string,
      scan_point_id: row.scan_point_id as string,
      user_id: String(row.user_id),
      movement_type: row.movement_type as 'IN' | 'OUT',
      quantity_packages: row.quantity_packages as number,
      conversion_factor_snapshot: row.conversion_factor_snapshot as number,
      quantity_base: String(row.quantity_base),
      inventory_before: String(row.inventory_before),
      inventory_after: String(row.inventory_after),
      created_at: row.created_at as Date,
    };
  }
}
