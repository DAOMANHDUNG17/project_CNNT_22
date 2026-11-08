import { ConfigService } from '@nestjs/config';
import { DatabaseService } from './database.service';

describe('DatabaseService', () => {
  it('requires DATABASE_URL at startup', () => {
    const configService = { get: () => undefined } as unknown as ConfigService;

    expect(() => new DatabaseService(configService)).toThrow(
      'DATABASE_URL is required to start the application',
    );
  });
});
