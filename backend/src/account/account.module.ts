import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { UsersModule } from '../users/users.module';
import { AccountController, AdminPasswordController } from './account.controller';
import { PasswordAttemptsService } from './password-attempts.service';
import { PasswordManagementService } from './password-management.service';

@Module({ imports: [AuthModule, DatabaseModule, UsersModule], controllers: [AccountController, AdminPasswordController],
  providers: [PasswordManagementService, PasswordAttemptsService] })
export class AccountModule {}
