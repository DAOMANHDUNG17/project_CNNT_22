import { DatabaseService } from '../database/database.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const checkHealth = jest.fn();
  const controller = new HealthController({
    checkHealth,
  } as unknown as DatabaseService);

  beforeEach(() => {
    checkHealth.mockReset().mockResolvedValue(undefined);
  });

  it('reports the API and database as healthy', async () => {
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      service: 'smart-warehouse-api',
      database: 'connected',
    });
    await expect(controller.checkDatabase()).resolves.toEqual({
      status: 'ok',
      database: 'connected',
    });
  });

  it('returns a safe 503 response when the database is unavailable', async () => {
    checkHealth.mockRejectedValue(new Error('sensitive connection detail'));

    await expect(controller.check()).rejects.toMatchObject({
      response: { status: 'error', database: 'disconnected' },
      status: 503,
    });
  });
});
