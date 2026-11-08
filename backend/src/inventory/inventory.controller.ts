import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { InventoryService } from './inventory.service';

@Controller('inventory')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @Roles('ADMIN', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List inventory with product details' })
  @ApiOkResponse({
    description: 'Current inventory from public.inventory joined with public.products',
    schema: {
      type: 'object',
      required: ['data', 'count'],
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            required: ['product_id', 'product_name', 'base_unit', 'is_active', 'quantity_base', 'updated_at'],
            properties: {
              product_id: { type: 'string' },
              product_name: { type: 'string' },
              base_unit: { type: 'string' },
              is_active: { type: 'boolean' },
              quantity_base: { type: 'string', example: '240' },
              updated_at: { type: 'string', format: 'date-time' },
            },
          },
        },
        count: { type: 'integer', example: 12 },
      },
    },
  })
  findAll() {
    return this.inventoryService.findAll();
  }
}
