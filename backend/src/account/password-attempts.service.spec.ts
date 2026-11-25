import { PasswordAttemptsService } from './password-attempts.service';

describe('Password attempt limits', () => {
  afterEach(() => jest.restoreAllMocks());
  it('counts failed attempts, allows five and expires after fifteen minutes', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const service = new PasswordAttemptsService();
    for (let i = 0; i < 5; i++) await expect(service.run('1', async () => { throw new Error('fixture'); })).rejects.toThrow();
    const operation = jest.fn();
    await expect(service.run('1', operation)).rejects.toMatchObject({ status: 429 });
    expect(operation).not.toHaveBeenCalled();
    clock.mockReturnValue(901001);
    await expect(service.run('1', async () => true)).resolves.toBe(true);
  });
  it('blocks concurrent mutations, releases the lock and isolates actors', async () => {
    const service = new PasswordAttemptsService();
    let release!: () => void;
    const pending = service.run('1', () => new Promise<void>(resolve => { release = resolve; }));
    await expect(service.run('1', async () => true)).rejects.toMatchObject({ status: 429 });
    await expect(service.run('2', async () => true)).resolves.toBe(true);
    release(); await pending;
    await expect(service.run('1', async () => true)).resolves.toBe(true);
  });
});
