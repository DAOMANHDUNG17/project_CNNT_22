import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';

@Injectable()
export class JwtVerifierService {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;

  constructor(configService: ConfigService) {
    const supabaseUrl = configService.get<string>('SUPABASE_URL');
    if (!supabaseUrl?.trim()) {
      throw new Error('SUPABASE_URL is required to start the application');
    }

    const baseUrl = new URL(supabaseUrl);
    if (baseUrl.protocol !== 'https:') {
      throw new Error('SUPABASE_URL must use HTTPS');
    }

    this.issuer = new URL('/auth/v1', baseUrl).toString();
    this.jwks = createRemoteJWKSet(
      new URL('/auth/v1/.well-known/jwks.json', baseUrl),
      { cacheMaxAge: 600_000, timeoutDuration: 5_000 },
    );
  }

  async verify(token: string): Promise<string> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      audience: 'authenticated',
      algorithms: ['ES256', 'RS256'],
      requiredClaims: ['exp', 'sub'],
    });

    const subject = payload.sub;
    if (
      typeof subject !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        subject,
      )
    ) {
      throw new Error('Invalid JWT subject');
    }

    return subject;
  }
}
