import { Body, Controller, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateStockMovementDto } from './create-stock-movement.dto';
import { StockMovementsService } from './stock-movements.service';

const responseSchema = {
  type: 'object', required: ['data'], properties: { data: {
    type: 'object', required: ['transaction_id', 'product_id', 'product_name', 'product_unit_id', 'unit_name', 'scan_code_snapshot', 'scan_point_id', 'user_id', 'movement_type', 'quantity_packages', 'conversion_factor_snapshot', 'quantity_base', 'inventory_before', 'inventory_after', 'created_at'],
    properties: {
      transaction_id: { type: 'string', format: 'uuid' }, product_id: { type: 'string' }, product_name: { type: 'string' },
      product_unit_id: { type: 'string' }, unit_name: { type: 'string' }, scan_code_snapshot: { type: 'string' },
      scan_point_id: { type: 'string' }, user_id: { type: 'string' }, movement_type: { type: 'string', enum: ['IN', 'OUT'] },
      quantity_packages: { type: 'integer', example: 2 }, conversion_factor_snapshot: { type: 'integer', example: 24 },
      quantity_base: { type: 'string', example: '48' }, inventory_before: { type: 'string', example: '100' },
      inventory_after: { type: 'string', example: '148' }, created_at: { type: 'string', format: 'date-time' },
    },
  } },
};

@Controller('stock-movements')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
export class StockMovementsController {
  constructor(private readonly service: StockMovementsService) {}

  @Post()
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Confirm IN or OUT at an explicitly assigned scan point', description: 'STAFF scan_point_id is resolved from the unique active DB assignment; a supplied different point is forbidden. ADMIN also needs an explicit grant. Account/grant/point locks cover authorization and commit, including UUID retries. A replay requires current permission for its original point and never rewrites history. quantity_packages defaults to one; conversion and inventory are calculated in the backend.' })
  @ApiBody({ type: CreateStockMovementDto })
  @ApiResponse({ status: 201, description: 'New IN or OUT movement committed', schema: responseSchema })
  @ApiResponse({ status: 200, description: 'Idempotent retry; no new movement', schema: responseSchema })
  @ApiResponse({ status: 400, description: 'Invalid DTO' })
  @ApiResponse({ status: 401, description: 'Bearer token required' })
  @ApiResponse({ status: 403, description: 'Inactive/VIEWER account, missing or ambiguous assignment, spoofed/revoked point, disabled assigned point or unauthorized replay' })
  @ApiResponse({ status: 404, description: 'Scan code or scan point not found' })
  @ApiResponse({ status: 409, description: 'Insufficient stock, inactive product/point, conflicting UUID, inconsistent inventory, or stock overflow' })
  @ApiResponse({ status: 500, description: 'Unexpected database error without sensitive details' })
  async create(@Body() dto: CreateStockMovementDto, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.service.create(dto, request.user!);
    response.status(result.replay ? HttpStatus.OK : HttpStatus.CREATED);
    return { data: result.data };
  }
}
