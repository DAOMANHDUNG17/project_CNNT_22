import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ScanPointsController } from './scan-points.controller';
import { ScanPointsService } from './scan-points.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [ScanPointsController],
  providers: [ScanPointsService],
})
export class ScanPointsModule {}
