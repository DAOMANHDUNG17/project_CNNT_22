import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DashboardQueryDto } from './dashboard-query.dto';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  @Roles('ADMIN', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Read-only warehouse dashboard', description: 'UTC from/to dates are inclusive. Counts and quantities are exact decimal strings. Low stock excludes products without inventory.' })
  @ApiOkResponse({ description: 'Summary, trends, paginated top products, latest five transactions, and up to five low-stock products.', schema: {
    type: 'object', required: ['summary', 'trends', 'top', 'latest', 'low_stock'], properties: {
      summary: { type: 'object', properties: {
        products: { type: 'object', properties: Object.fromEntries(['total', 'active', 'inactive', 'missing_inventory'].map(key => [key, { type: 'string' }])) },
        inventory_totals: { type: 'array', items: { type: 'object', properties: { base_unit: { type: 'string' }, quantity_base: { type: 'string' } } } },
        transactions: { type: 'object', properties: { IN: { type: 'string' }, OUT: { type: 'string' }, total: { type: 'string' } } },
        low_stock: { type: 'object', properties: { threshold: { type: 'string' }, product_count: { type: 'string' } } },
      } },
      trends: { type: 'array', items: { type: 'object', properties: { period_start: { type: 'string', format: 'date-time' }, in_count: { type: 'string' }, out_count: { type: 'string' }, total_count: { type: 'string' } } } },
      top: { type: 'object', properties: {
        data: { type: 'array', items: { type: 'object', properties: { product_id: { type: 'string' }, product_name: { type: 'string' }, base_unit: { type: 'string' }, transaction_count: { type: 'string' }, in_count: { type: 'string' }, out_count: { type: 'string' }, quantity_in_base: { type: 'string' }, quantity_out_base: { type: 'string' } } } },
        count: { type: 'integer' }, pagination: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } },
      } },
      latest: { type: 'array', items: { type: 'object', properties: { transaction_id: { type: 'string' }, product_id: { type: 'string' }, product_name: { type: 'string', nullable: true }, movement_type: { type: 'string', enum: ['IN', 'OUT'] }, quantity_packages: { type: 'integer' }, unit_name: { type: 'string', nullable: true }, point_name: { type: 'string', nullable: true }, created_at: { type: 'string', format: 'date-time' } } } },
      low_stock: { type: 'array', items: { type: 'object', properties: { product_id: { type: 'string' }, product_name: { type: 'string' }, base_unit: { type: 'string' }, quantity_base: { type: 'string' } } } },
    },
  } })
  @ApiResponse({ status: 400, description: 'Invalid query or date range' })
  @ApiResponse({ status: 401, description: 'Bearer JWT required' })
  @ApiResponse({ status: 403, description: 'Inactive account or role not permitted' })
  get(@Query() query: DashboardQueryDto) { return this.service.get(query); }
}
