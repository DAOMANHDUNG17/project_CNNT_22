import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({ imports: [DatabaseModule, AuthModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
