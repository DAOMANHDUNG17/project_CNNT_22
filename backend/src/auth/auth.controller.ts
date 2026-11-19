import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiTags } from '../api-docs';
import { AuthGuard } from './auth.guard';
import type { BusinessUser } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

@Controller('auth')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
@ApiTags(apiTags.account)
export class AuthController {
  @Get('me')
  @ApiOperation({ summary: 'Xem hồ sơ phiên hiện tại', description: 'Xác nhận tài khoản nghiệp vụ, vai trò và trạng thái của phiên Supabase đang dùng.' })
  @ApiOkResponse({
    description: 'Hồ sơ nghiệp vụ của phiên đang xác thực',
    schema: { example: { user_id: '42', username: 'staff-demo', display_name: 'Nhân viên kho', role: 'STAFF', is_active: true } },
  })
  @ApiResponse({ status: 401, description: 'Thiếu JWT hoặc JWT không hợp lệ' })
  @ApiResponse({ status: 403, description: 'Tài khoản nghiệp vụ thiếu quyền hoặc đã ngừng hoạt động' })
  me(@CurrentUser() user: BusinessUser) {
    return {
      user_id: user.user_id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      is_active: user.is_active,
    };
  }

  @Get('admin-check')
  @Roles('ADMIN')
  @ApiExcludeEndpoint()
  adminCheck() {
    return { status: 'ok', role: 'ADMIN' };
  }
}
