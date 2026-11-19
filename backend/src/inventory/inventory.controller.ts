import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { apiTags } from '../api-docs';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { InventoryService } from './inventory.service';

@Controller('inventory')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
@ApiTags(apiTags.inventory)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @Roles('ADMIN', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Xem tồn kho hiện tại', description: 'Tìm product_id trong data. So sánh quantity_base và updated_at trước và sau các lượt KT2.' })
  @ApiOkResponse({
    description: 'Số tồn hiện tại theo đơn vị cơ sở của từng sản phẩm',
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
