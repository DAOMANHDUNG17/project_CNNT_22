import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ProductUnitsService } from './product-units.service';

@Controller('product-units')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
export class ProductUnitsController {
  constructor(private readonly productUnitsService: ProductUnitsService) {}

  @Get()
  @Roles('ADMIN', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List product units with product names' })
  @ApiOkResponse({
    description: 'All product units from public.product_units joined with public.products',
    schema: {
      type: 'object',
      required: ['data', 'count'],
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            required: ['product_unit_id', 'product_id', 'product_name', 'unit_name', 'conversion_factor', 'scan_code', 'is_base_unit', 'created_at'],
            properties: {
              product_unit_id: { type: 'string', example: '1' },
              product_id: { type: 'string', example: 'SP001' },
              product_name: { type: 'string' },
              unit_name: { type: 'string' },
              conversion_factor: { type: 'integer', example: 12 },
              scan_code: { type: 'string' },
              is_base_unit: { type: 'boolean' },
              created_at: { type: 'string', format: 'date-time' },
            },
          },
        },
        count: { type: 'integer', example: 28 },
      },
    },
  })
  findAll() {
    return this.productUnitsService.findAll();
  }
}
