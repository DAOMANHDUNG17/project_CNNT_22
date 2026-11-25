import { Body, Controller, Get, Headers, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { BusinessUser } from '../auth/auth.types';
import { UserIdDto } from '../users/users.dto';
import { PasswordManagementService } from './password-management.service';
import { ChangePasswordDto, ResetPasswordDto } from './password.dto';
import { apiTags } from '../api-docs';

@Controller('account')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN', 'STAFF', 'VIEWER')
@ApiBearerAuth()
@ApiTags(apiTags.account)
@ApiResponse({ status: 401, description: 'JWT required' })
@ApiResponse({ status: 403, description: 'Active business profile required' })
@ApiResponse({ status: 503, description: 'Auth unavailable; never retry a password mutation automatically' })
export class AccountController {
  constructor(private readonly service: PasswordManagementService) {}
  @Get()
  @ApiOperation({ summary: 'Thông tin tài khoản của chính mình', description: 'Only own email and permitted business profile. Scan points use GET /scan-points/my.' })
  @ApiOkResponse({ description: '{ user_id, username, display_name, role, email }; no credentials or Auth metadata' })
  profile(@CurrentUser() actor: BusinessUser, @Headers('authorization') authorization: string) {
    return this.service.profile(actor, authorization.slice(7));
  }
  @Patch('password')
  @ApiOperation({ summary: 'Đổi mật khẩu của chính mình', description: 'Server verifies current password with Supabase Auth, binds Auth UUID, updates password and requests global logout. Access JWTs may remain valid until expiry.' })
  @ApiOkResponse({ description: '{ changed, requires_relogin, refresh_sessions_revoked }; logout acknowledgement is not proof all JWTs are revoked' })
  @ApiResponse({ status: 400, description: 'Invalid password, mismatch, same password or provider policy rejection' })
  @ApiResponse({ status: 429, description: '5 attempts per authenticated actor / 15 minutes; no concurrent requests' })
  change(@CurrentUser() actor: BusinessUser, @Headers('authorization') authorization: string, @Body() dto: ChangePasswordDto) {
    return this.service.change(actor, authorization.slice(7), dto);
  }
}

@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
@ApiTags(apiTags.administration)
export class AdminPasswordController {
  constructor(private readonly service: PasswordManagementService) {}
  @Patch(':id/password')
  @ApiOperation({ summary: 'ADMIN đặt lại mật khẩu người dùng', description: 'Positive BIGINT business ID, mapped server-side to Auth UUID. Active ADMIN rechecked under account lock. No profile/role/scan-point changes. Self-target must use /account/password.' })
  @ApiOkResponse({ description: '{ changed: true, requires_relogin: false, refresh_sessions_revoked: false }; existing sessions not guaranteed revoked' })
  @ApiResponse({ status: 400, description: 'Invalid password, ID or self-target' })
  @ApiResponse({ status: 401, description: 'JWT required' })
  @ApiResponse({ status: 403, description: 'Active ADMIN required' })
  @ApiResponse({ status: 404, description: 'Business/Auth target not found' })
  @ApiResponse({ status: 429, description: '5 attempts per actor / 15 minutes, shared with self change' })
  @ApiResponse({ status: 503, description: 'Auth/database unavailable or outcome unconfirmed' })
  reset(@CurrentUser() actor: BusinessUser, @Param() params: UserIdDto, @Body() dto: ResetPasswordDto) {
    return this.service.reset(actor, params.id, dto);
  }
}
