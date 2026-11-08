import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from './auth.guard';
import type { BusinessUser } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

@Controller('auth')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
export class AuthController {
  @Get('me')
  @ApiOperation({ summary: 'Get the current business user' })
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
  @ApiOperation({ summary: 'Check administrator access' })
  adminCheck() {
    return { status: 'ok', role: 'ADMIN' };
  }
}
