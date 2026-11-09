import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateProductDto } from './create-product.dto';
import { PatchProductDto, ProductIdParamDto } from './patch-product.dto';
import { ProductsService } from './products.service';

@Controller('products')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Roles('ADMIN', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List products' })
  @ApiOkResponse({
    description: 'All products from public.products',
    schema: {
      type: 'object',
      required: ['data', 'count'],
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            required: ['product_id', 'product_name', 'base_unit', 'is_active', 'created_at', 'updated_at'],
            properties: {
              product_id: { type: 'string' },
              product_name: { type: 'string' },
              base_unit: { type: 'string' },
              is_active: { type: 'boolean' },
              created_at: { type: 'string', format: 'date-time' },
              updated_at: { type: 'string', format: 'date-time' },
            },
          },
        },
        count: { type: 'integer', example: 12 },
      },
    },
  })
  findAll() {
    return this.productsService.findAll();
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Declare a new product without stock movement' })
  @ApiBody({ type: CreateProductDto })
  @ApiCreatedResponse({
    description: 'Product created; the database trigger initializes inventory to zero',
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'object',
          required: ['product_id', 'product_name', 'base_unit', 'is_active', 'created_at', 'updated_at'],
          properties: {
            product_id: { type: 'string' },
            product_name: { type: 'string' },
            base_unit: { type: 'string' },
            is_active: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Edit product name or active status without changing stock', description: 'At least one of product_name or is_active is required. Deactivation requires zero inventory.' })
  @ApiParam({ name: 'id', example: 'SP013', description: 'Existing product ID, at most 20 characters' })
  @ApiBody({ type: PatchProductDto, description: 'At least one field required. Unknown fields are rejected.' })
  @ApiOkResponse({ description: 'Updated or unchanged product; updated_at changes only when data changes', schema: {
    type: 'object', required: ['data'], properties: { data: { type: 'object',
      required: ['product_id', 'product_name', 'base_unit', 'is_active', 'created_at', 'updated_at'],
      properties: {
        product_id: { type: 'string' }, product_name: { type: 'string' }, base_unit: { type: 'string' },
        is_active: { type: 'boolean' }, created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
      },
    } },
  } })
  @ApiResponse({ status: 400, description: 'Invalid ID, body or unsupported fields' })
  @ApiResponse({ status: 401, description: 'Bearer token required' })
  @ApiResponse({ status: 403, description: 'ADMIN role required' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 409, description: 'Cannot deactivate with stock, or inventory row missing' })
  update(@Param() params: ProductIdParamDto, @Body() dto: PatchProductDto) {
    return this.productsService.update(params.id, dto);
  }
}
