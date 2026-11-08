import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import postgres from 'postgres';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly client: ReturnType<typeof postgres>;

  constructor(configService: ConfigService) {
    const databaseUrl = configService.get<string>('DATABASE_URL');
    if (!databaseUrl?.trim()) {
      throw new Error('DATABASE_URL is required to start the application');
    }

    this.client = postgres(databaseUrl, { ssl: 'require', connect_timeout: 5 });
  }

  query(text: string, parameters: (string | number | boolean | null)[] = []) {
    return this.client.unsafe(text, parameters);
  }

  async checkHealth(): Promise<void> {
    await this.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.end();
  }
}
