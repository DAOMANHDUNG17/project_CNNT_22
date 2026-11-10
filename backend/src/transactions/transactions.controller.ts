import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TransactionsQueryDto } from './transactions-query.dto';
import { TransactionsService } from './transactions.service';

@Controller('transactions')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}

  @Get()
  @Roles('ADMIN', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Read-only transaction history. No inventory modification.', description: 'Exact filters; from inclusive and to exclusive. Current descriptive names are joined by ID; numeric and scan snapshots are historical. Sorted by created_at DESC, transaction_id DESC. count is the filtered total.' })
  @ApiOkResponse({ schema: { type: 'object', required: ['data', 'count', 'pagination'], properties: {
    data: { type: 'array', items: { type: 'object', properties: {
      transaction_id: { type: 'string', format: 'uuid' }, product_id: { type: 'string' },
      product_name: { type: 'string', nullable: true }, product_unit_id: { type: 'string' }, unit_name: { type: 'string', nullable: true },
      movement_type: { type: 'string', enum: ['IN', 'OUT'] }, quantity_packages: { type: 'integer' },
      conversion_factor_snapshot: { type: 'integer' }, quantity_base: { type: 'string' },
      inventory_before: { type: 'string' }, inventory_after: { type: 'string' }, scan_code_snapshot: { type: 'string' },
      scan_point_id: { type: 'string' }, point_name: { type: 'string', nullable: true }, user_id: { type: 'string' },
      display_name: { type: 'string', nullable: true }, created_at: { type: 'string', format: 'date-time' },
    } } }, count: { type: 'integer' }, pagination: { type: 'object', properties: {
      page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' },
    } },
  } } })
  @ApiResponse({ status: 400, description: 'Invalid query or from is not before to' })
  @ApiResponse({ status: 401, description: 'Valid Bearer JWT required' })
  @ApiResponse({ status: 403, description: 'Business account inactive or role not permitted' })
  @ApiResponse({ status: 500, description: 'Safe unexpected database error' })
  findAll(@Query() query: TransactionsQueryDto) {
    return this.service.findAll(query);
  }
}
