import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { ProductsModule } from './products/products.module';
import { ProductUnitsModule } from './product-units/product-units.module';
import { ScanPointsModule } from './scan-points/scan-points.module';
import { StockMovementsModule } from './stock-movements/stock-movements.module';
import { TransactionsModule } from './transactions/transactions.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { UsersModule } from './users/users.module';
import { AccountModule } from './account/account.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    InventoryModule,
    ProductsModule,
    ProductUnitsModule,
    ScanPointsModule,
    StockMovementsModule,
    TransactionsModule,
    DashboardModule,
    UsersModule,
    AccountModule,
  ],
})
export class AppModule {}
