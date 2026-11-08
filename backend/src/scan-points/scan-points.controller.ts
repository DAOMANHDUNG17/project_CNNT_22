import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ScanPointsService } from './scan-points.service';

@Controller('scan-points')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
export class ScanPointsController {
  constructor(private readonly scanPointsService: ScanPointsService) {}

  @Get()
  @Roles('ADMIN', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List scan points' })
  @ApiOkResponse({
    description: 'All scan points from public.scan_points',
    schema: {
      type: 'object',
      required: ['data', 'count'],
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            required: ['scan_point_id', 'point_name', 'is_active', 'created_at'],
            properties: {
              scan_point_id: { type: 'string' },
              point_name: { type: 'string' },
              is_active: { type: 'boolean' },
              created_at: { type: 'string', format: 'date-time' },
            },
          },
        },
        count: { type: 'integer', example: 2 },
      },
    },
  })
  findAll() {
    return this.scanPointsService.findAll();
  }
}
