import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ScanPointsService } from './scan-points.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { BusinessUser } from '../auth/auth.types';
import { MyScanPointsQueryDto } from '../users/scan-point-access.dto';

@Controller('scan-points')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
export class ScanPointsController {
  constructor(private readonly scanPointsService: ScanPointsService) {}

  @Get('my')
  @Roles('ADMIN', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List active points explicitly granted to the authenticated account', description: 'No ADMIN bypass. VIEWER receives an empty list. Account and grant status are read from the database. No user ID query is accepted.' })
  @ApiOkResponse({ description: '{ data, count } with active scan points only' })
  my(@CurrentUser() user: BusinessUser, @Query() _query: MyScanPointsQueryDto) {
    return this.scanPointsService.findMine(user);
  }

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
