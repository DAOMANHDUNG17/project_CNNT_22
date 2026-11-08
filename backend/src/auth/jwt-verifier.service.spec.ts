import { ConfigService } from '@nestjs/config';
import { JwtVerifierService } from './jwt-verifier.service';

describe('JwtVerifierService', () => {
  it('requires SUPABASE_URL at startup', () => {
    const configService = { get: () => undefined } as unknown as ConfigService;
    expect(() => new JwtVerifierService(configService)).toThrow(
      'SUPABASE_URL is required to start the application',
    );
  });

  it('rejects a malformed JWT', async () => {
    const configService = {
      get: () => 'https://example.supabase.co',
    } as unknown as ConfigService;
    const verifier = new JwtVerifierService(configService);
    await expect(verifier.verify('not-a-jwt')).rejects.toThrow();
  });
});
