import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiTags } from '../api-docs';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { BusinessUser } from '../auth/auth.types';
import { CreateUserDto, PatchUserDto, UserIdDto, UsersQueryDto } from './users.dto';
import { UsersService } from './users.service';
import { ReplaceScanPointAccessDto } from './scan-point-access.dto';

@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
@ApiResponse({ status: 400, description: 'Invalid input or unsupported fields' })
@ApiResponse({ status: 401, description: 'Valid JWT required' })
@ApiResponse({ status: 403, description: 'Active ADMIN required' })
@ApiResponse({ status: 409, description: 'Duplicate username/email or last active ADMIN' })
@ApiResponse({ status: 500, description: 'Failed to persist user' })
@ApiResponse({ status: 503, description: 'Database/Auth unavailable or provisioning outcome unknown' })
export class UsersController {
  constructor(private readonly service: UsersService) {}
  @Get()
  @ApiTags(apiTags.administration)
  @ApiOperation({ summary: 'Xem danh sách tài khoản', description: 'ADMIN lọc tài khoản nghiệp vụ theo vai trò, trạng thái hoặc từ khóa.' })
  @ApiOkResponse({ description: 'Filtered paginated users. user_id is a BIGINT string.' })
  findAll(@Query() query: UsersQueryDto) { return this.service.findAll(query); }
  @Post()
  @ApiTags(apiTags.administration)
  @ApiOperation({ summary: 'Tạo tài khoản kho', description: 'ADMIN tạo danh tính Supabase Auth và hồ sơ nghiệp vụ đi kèm.' })
  @ApiBody({ type: CreateUserDto, examples: {
    staff: { summary: 'Tài khoản STAFF', value: {
      username: 'staff-demo', display_name: 'Nhân viên kho', email: 'staff@example.com',
      role: 'STAFF', password: '<mật khẩu mới>', is_active: true,
    } },
  } })
  @ApiCreatedResponse({ description: 'Auth identity and business user both confirmed' })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: BusinessUser) { return this.service.create(dto, actor); }
  @Get(':id/scan-points')
  @ApiTags(apiTags.scanPoints)
  @ApiOperation({ summary: 'Xem phân công của một tài khoản', description: 'ADMIN xem quyền đang hoạt động và quyền đã thu hồi theo user_id.' })
  @ApiOkResponse({ description: '{ data, count }; is_active is the grant status; scan_point_is_active is the point status. BIGINT IDs are strings.' })
  @ApiResponse({ status: 404, description: 'User not found' })
  scanPoints(@Param() params: UserIdDto) { return this.service.getScanPointAccess(params.id); }
  @Put(':id/scan-points')
  @ApiTags(apiTags.scanPoints)
  @ApiOperation({ summary: 'Cập nhật phân công điểm quét', description: 'ADMIN gửi toàn bộ danh sách điểm được chọn. Chỉ nhận điểm đang hoạt động. Mảng rỗng thu hồi toàn bộ phân công.' })
  @ApiBody({ type: ReplaceScanPointAccessDto, examples: {
    assign: { summary: 'Phân công SCAN-01', value: { scan_point_ids: ['SCAN-01'] } },
    revoke: { summary: 'Thu hồi toàn bộ phân công', value: { scan_point_ids: [] } },
  } })
  @ApiOkResponse({ description: 'Committed grant list, including revoked grants' })
  @ApiResponse({ status: 404, description: 'User or selected scan point not found' })
  replaceScanPoints(@Param() params: UserIdDto, @Body() dto: ReplaceScanPointAccessDto, @CurrentUser() actor: BusinessUser) {
    return this.service.replaceScanPointAccess(params.id, dto.scan_point_ids, actor);
  }
  @Patch(':id')
  @ApiTags(apiTags.administration)
  @ApiOperation({ summary: 'Sửa hồ sơ, vai trò hoặc trạng thái', description: 'ADMIN chỉnh thông tin tài khoản. Email và danh tính Auth giữ nguyên. Hệ thống bảo vệ ADMIN đang hoạt động cuối cùng.' })
  @ApiOkResponse({ description: 'Updated business user' })
  @ApiResponse({ status: 404, description: 'User not found' })
  update(@Param() params: UserIdDto, @Body() dto: PatchUserDto, @CurrentUser() actor: BusinessUser) { return this.service.update(params.id, dto, actor); }
}
