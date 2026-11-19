import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiTags } from '../api-docs';
import { DatabaseService } from '../database/database.service';

@Controller('health')
@ApiTags(apiTags.administration)
export class HealthController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Get()
  @ApiOperation({ summary: 'Kiểm tra tình trạng dịch vụ', description: 'Kiểm tra API và kết nối PostgreSQL trước khi chạy kiểm thử.' })
  @ApiOkResponse({
    description: 'Dịch vụ hoạt động và đã kết nối PostgreSQL',
    schema: { example: { status: 'ok', service: 'smart-warehouse-api', database: 'connected' } },
  })
  @ApiResponse({ status: 503, description: 'PostgreSQL chưa sẵn sàng', schema: { example: { status: 'error', database: 'disconnected' } } })
  async check() {
    await this.assertDatabaseConnected();
    return {
      status: 'ok',
      service: 'smart-warehouse-api',
      database: 'connected',
    };
  }

  @Get('database')
  @ApiExcludeEndpoint()
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
