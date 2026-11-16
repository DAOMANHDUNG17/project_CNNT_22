import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { BusinessUser } from '../auth/auth.types';
import { CreateUserDto, PatchUserDto, UserIdDto, UsersQueryDto } from './users.dto';
import { UsersService } from './users.service';
import { ReplaceScanPointAccessDto } from './scan-point-access.dto';

@ApiTags('Users')
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
  @ApiOperation({ summary: 'List business users with Auth email; no credentials returned' })
  @ApiOkResponse({ description: 'Filtered paginated users. user_id is a BIGINT string.' })
  findAll(@Query() query: UsersQueryDto) { return this.service.findAll(query); }
  @Post()
  @ApiOperation({ summary: 'Provision Supabase Auth identity and linked business user' })
  @ApiCreatedResponse({ description: 'Auth identity and business user both confirmed' })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: BusinessUser) { return this.service.create(dto, actor); }
  @Get(':id/scan-points')
  @ApiOperation({ summary: 'Read active and revoked scan-point grants for a business user' })
  @ApiOkResponse({ description: '{ data, count }; is_active is the grant status; scan_point_is_active is the point status. BIGINT IDs are strings.' })
  @ApiResponse({ status: 404, description: 'User not found' })
  scanPoints(@Param() params: UserIdDto) { return this.service.getScanPointAccess(params.id); }
  @Put(':id/scan-points')
  @ApiOperation({ summary: 'Atomically replace scan-point grants', description: 'Only active existing points can be selected. Empty selection revokes all grants. assigned_by is determined from the authenticated ADMIN. Repeated saves do not create duplicates.' })
  @ApiOkResponse({ description: 'Committed grant list, including revoked grants' })
  @ApiResponse({ status: 404, description: 'User or selected scan point not found' })
  replaceScanPoints(@Param() params: UserIdDto, @Body() dto: ReplaceScanPointAccessDto, @CurrentUser() actor: BusinessUser) {
    return this.service.replaceScanPointAccess(params.id, dto.scan_point_ids, actor);
  }
  @Patch(':id')
  @ApiOperation({ summary: 'Edit user profile, role or status; protect last active ADMIN', description: 'Email and Auth identity are immutable. Roles/status are checked from the database on each protected request.' })
  @ApiOkResponse({ description: 'Updated business user' })
  @ApiResponse({ status: 404, description: 'User not found' })
  update(@Param() params: UserIdDto, @Body() dto: PatchUserDto, @CurrentUser() actor: BusinessUser) { return this.service.update(params.id, dto, actor); }
}
