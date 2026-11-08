import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Get()
  async check() {
    await this.assertDatabaseConnected();
    return {
      status: 'ok',
      service: 'smart-warehouse-api',
      database: 'connected',
    };
  }

  @Get('database')
  async checkDatabase() {
    await this.assertDatabaseConnected();
    return { status: 'ok', database: 'connected' };
  }

  private async assertDatabaseConnected(): Promise<void> {
    try {
      await this.databaseService.checkHealth();
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'disconnected',
      });
    }
  }
}
