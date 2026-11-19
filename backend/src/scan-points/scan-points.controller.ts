import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { apiTags } from '../api-docs';
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
@ApiTags(apiTags.scanPoints)
export class ScanPointsController {
  constructor(private readonly scanPointsService: ScanPointsService) {}

  @Get('my')
  @Roles('ADMIN', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Xem điểm quét của phiên hiện tại', description: 'Trả các điểm đang hoạt động được cấp cho tài khoản, kể cả khi dùng ADMIN. VIEWER nhận danh sách rỗng.' })
  @ApiOkResponse({
    description: 'Danh sách điểm quét được cấp và tổng số điểm',
    schema: { example: { data: [{ scan_point_id: 'SCAN-01', point_name: 'Cổng kho', is_active: true, created_at: '2026-01-01T00:00:00.000Z' }], count: 1 } },
  })
  my(@CurrentUser() user: BusinessUser, @Query() _query: MyScanPointsQueryDto) {
    return this.scanPointsService.findMine(user);
  }

  @Get()
  @Roles('ADMIN', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Xem danh mục điểm quét', description: 'Liệt kê các điểm quét cùng trạng thái hiện tại.' })
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
