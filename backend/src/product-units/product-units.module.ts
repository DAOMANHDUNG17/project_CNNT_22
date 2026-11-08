import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ProductUnitsController } from './product-units.controller';
import { ProductUnitsService } from './product-units.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [ProductUnitsController],
  providers: [ProductUnitsService],
})
export class ProductUnitsModule {}
