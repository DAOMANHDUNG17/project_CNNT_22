import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { apiTags } from '../api-docs';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateStockMovementDto } from './create-stock-movement.dto';
import { StockMovementsService } from './stock-movements.service';

const createdMessage = 'Giao dịch được tạo thành công.';
const replayMessage = 'Giao dịch đã được xử lý trước đó. Hệ thống không ghi trùng và không cập nhật tồn kho lần nữa.';
const exampleRequest = {
  transaction_id: '550e8400-e29b-41d4-a716-446655440000',
  scan_code: 'SW-SP013-BOX24',
  scan_point_id: 'SCAN-01',
  movement_type: 'IN',
  quantity_packages: 2,
} as const;

const movementSchema = {
  type: 'object', required: ['transaction_id', 'product_id', 'product_name', 'product_unit_id', 'unit_name', 'scan_code_snapshot', 'scan_point_id', 'user_id', 'movement_type', 'quantity_packages', 'conversion_factor_snapshot', 'quantity_base', 'inventory_before', 'inventory_after', 'created_at'],
  properties: {
    transaction_id: { type: 'string', format: 'uuid' }, product_id: { type: 'string' }, product_name: { type: 'string' },
    product_unit_id: { type: 'string' }, unit_name: { type: 'string' }, scan_code_snapshot: { type: 'string' },
    scan_point_id: { type: 'string' }, user_id: { type: 'string' }, movement_type: { type: 'string', enum: ['IN', 'OUT'] },
    quantity_packages: { type: 'integer', example: 2 }, conversion_factor_snapshot: { type: 'integer', example: 24 },
    quantity_base: { type: 'string', example: '48' }, inventory_before: { type: 'string', example: '100' },
    inventory_after: { type: 'string', example: '148' }, created_at: { type: 'string', format: 'date-time' },
  },
};

function successSchema(isDuplicate: boolean, message: string) {
  return {
    type: 'object',
    required: ['message', 'is_duplicate', 'data'],
    properties: {
      message: { type: 'string', example: message },
      is_duplicate: { type: 'boolean', enum: [isDuplicate], example: isDuplicate },
      data: movementSchema,
    },
  };
}

@Controller('stock-movements')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
@ApiTags(apiTags.movements)
export class StockMovementsController {
  constructor(private readonly service: StockMovementsService) {}

  @Post()
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({
    summary: 'Ghi nhận nhập / xuất kho · KT1, KT2',
    description: [
      'Dùng mã quét có thật và điểm quét đang được phân công. Nếu bỏ quantity_packages, hệ thống dùng 1 gói và quy đổi từ danh mục đơn vị.',
      '**Demo KT2**',
      '1. Gửi UUID mới và body hợp lệ → **201**, `is_duplicate: false`, tồn thay đổi đúng một lần.',
      '2. Sao chép nguyên `data.transaction_id` từ phản hồi 201 vào `transaction_id` và giữ nguyên các trường còn lại → **200**, `is_duplicate: true`, trả giao dịch gốc và giữ nguyên tồn.',
      '3. Giữ đúng UUID vừa sao chép. Đổi số gói, đổi loại nhập/xuất hoặc dùng mã quét của sản phẩm khác → **409** với request hợp lệ và đủ quyền. Lịch sử và tồn giữ nguyên.',
      '`transaction_id` là duy nhất trên toàn bộ lịch sử nhập/xuất. Đổi giá trị một chữ số hex sẽ thành UUID khác. Backend xác định sản phẩm từ `scan_code`.',
      'Sau mỗi lượt, xem **GET /api/inventory** và lọc **GET /api/transactions** theo transactionId để đối chiếu. Replay cần đúng tài khoản đã gửi giao dịch và quyền tại điểm quét gốc.',
    ].join('\n\n'),
  })
  @ApiBody({ type: CreateStockMovementDto, examples: {
    kt2: { summary: 'KT2 · Nhập 2 gói, thay UUID và mã quét trước lượt đầu', value: exampleRequest },
  } })
  @ApiResponse({ status: 201, description: 'Giao dịch mới đã được ghi nhận và tồn kho đã được cập nhật', schema: successSchema(false, createdMessage) })
  @ApiResponse({ status: 200, description: 'Replay đúng payload, trả giao dịch đã lưu và giữ nguyên tồn kho', schema: successSchema(true, replayMessage) })
  @ApiResponse({ status: 400, description: 'Invalid DTO' })
  @ApiResponse({ status: 401, description: 'Bearer token required' })
  @ApiResponse({ status: 403, description: 'Inactive/VIEWER account, missing or ambiguous assignment, spoofed/revoked point, disabled assigned point or unauthorized replay' })
  @ApiResponse({ status: 404, description: 'Mã quét không tồn tại' })
  @ApiResponse({
    status: 409,
    description: 'UUID đã được dùng cho giao dịch có nội dung khác (kể cả sản phẩm khác), tồn không đủ, sản phẩm ngừng hoạt động hoặc dữ liệu tồn không hợp lệ',
    schema: {
      type: 'object',
      required: ['message', 'error', 'statusCode'],
      properties: {
        message: { type: 'string', example: 'Mã giao dịch đã được dùng cho một lượt nhập/xuất khác.' },
        error: { type: 'string', example: 'Conflict' },
        statusCode: { type: 'integer', example: 409 },
      },
    },
  })
  @ApiResponse({ status: 500, description: 'Unexpected database error without sensitive details' })
  async create(@Body() dto: CreateStockMovementDto, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.service.create(dto, request.user!);
    response.status(result.replay ? HttpStatus.OK : HttpStatus.CREATED);
    return {
      message: result.replay ? replayMessage : createdMessage,
      is_duplicate: result.replay,
      data: result.data,
    };
  }

  @Post('replay')
  @HttpCode(HttpStatus.OK)
  @Roles('STAFF')
  @ApiOperation({
    summary: 'Phát lại giao dịch đã lưu theo UUID',
    description: 'Dùng trong các collection KT2. Cần đúng STAFF đã thực hiện và còn quyền ở điểm quét gốc. UUID thiếu trả 404. Nội dung khác trả 409.',
  })
  @ApiBody({ type: CreateStockMovementDto })
  @ApiResponse({ status: 200, description: 'Existing movement replayed with no inventory write', schema: successSchema(true, replayMessage) })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Bearer token required' })
  @ApiResponse({ status: 403, description: 'Active STAFF and active scan-point access required' })
  @ApiResponse({ status: 404, description: 'Transaction UUID does not exist' })
  @ApiResponse({ status: 409, description: 'The UUID belongs to a transaction with different content or a different original user' })
  async replayExisting(@Body() dto: CreateStockMovementDto, @Req() request: AuthenticatedRequest) {
    const result = await this.service.create(dto, request.user!, 'replay-only');
    return { message: replayMessage, is_duplicate: true, data: result.data };
  }
}
