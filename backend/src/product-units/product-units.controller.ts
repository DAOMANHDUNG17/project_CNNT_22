import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiTags } from '../api-docs';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateProductUnitDto } from './create-product-unit.dto';
import { PatchProductUnitDto, ProductUnitIdParamDto } from './patch-product-unit.dto';
import { ProductUnitsService } from './product-units.service';

@Controller('product-units')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
@ApiTags(apiTags.catalog)
export class ProductUnitsController {
  constructor(private readonly productUnitsService: ProductUnitsService) {}

  @Get()
  @Roles('ADMIN', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Xem đơn vị đóng gói và mã quét', description: 'Tra sản phẩm, mã quét và hệ số quy đổi trước khi nhập hoặc xuất kho.' })
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

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Thêm đơn vị đóng gói', description: 'ADMIN gắn đơn vị, mã quét và hệ số quy đổi cho sản phẩm.' })
  @ApiBody({ type: CreateProductUnitDto })
  @ApiCreatedResponse({ description: 'Product unit created; BIGINT ID is a string', schema: {
    type: 'object', required: ['data'], properties: { data: { type: 'object',
      required: ['product_unit_id', 'product_id', 'product_name', 'unit_name', 'conversion_factor', 'scan_code', 'is_base_unit', 'created_at'],
      properties: {
        product_unit_id: { type: 'string', example: '29' },
        product_id: { type: 'string', example: 'SP013' },
        product_name: { type: 'string' },
        unit_name: { type: 'string', example: 'hộp' },
        conversion_factor: { type: 'integer', example: 20 },
        scan_code: { type: 'string', example: 'SW-SP013-20' },
        is_base_unit: { type: 'boolean', example: false },
        created_at: { type: 'string', format: 'date-time' },
      },
    } },
  } })
  @ApiResponse({ status: 400, description: 'Invalid DTO or base unit factor/name' })
  @ApiResponse({ status: 401, description: 'Bearer token required' })
  @ApiResponse({ status: 403, description: 'ADMIN role required' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 409, description: 'Inactive product, duplicate scan code/unit name, or existing base unit' })
  create(@Body() dto: CreateProductUnitDto) {
    return this.productUnitsService.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Sửa đơn vị đóng gói', description: 'ADMIN sửa thông tin đơn vị. Đổi tên đơn vị cơ sở đồng thời cập nhật tên đơn vị cơ sở của sản phẩm.' })
  @ApiParam({ name: 'id', description: 'Positive BIGINT product_unit_id', example: '29' })
  @ApiBody({ type: PatchProductUnitDto })
  @ApiOkResponse({ description: 'Updated product unit; BIGINT ID is a string', schema: {
    type: 'object', required: ['data'], properties: { data: { type: 'object',
      required: ['product_unit_id', 'product_id', 'product_name', 'unit_name', 'conversion_factor', 'scan_code', 'is_base_unit', 'created_at'],
      properties: {
        product_unit_id: { type: 'string', example: '29' },
        product_id: { type: 'string', example: 'SP013' },
        product_name: { type: 'string' },
        unit_name: { type: 'string' },
        conversion_factor: { type: 'integer' },
        scan_code: { type: 'string' },
        is_base_unit: { type: 'boolean' },
        created_at: { type: 'string', format: 'date-time' },
      },
    } },
  } })
  @ApiResponse({ status: 400, description: 'Invalid ID or DTO' })
  @ApiResponse({ status: 401, description: 'Bearer token required' })
  @ApiResponse({ status: 403, description: 'ADMIN role required' })
  @ApiResponse({ status: 404, description: 'Product unit not found' })
  @ApiResponse({ status: 409, description: 'Duplicate name/code, inconsistent base unit data, or unsafe conversion factor change' })
  @ApiResponse({ status: 500, description: 'Unexpected database error without sensitive details' })
  update(@Param() params: ProductUnitIdParamDto, @Body() dto: PatchProductUnitDto) {
    return this.productUnitsService.update(params.id, dto);
  }
}
