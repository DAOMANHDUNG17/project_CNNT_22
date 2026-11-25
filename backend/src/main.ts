import { isIP } from 'node:net';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { setupApiDocs } from './api-docs';
import { AppModule } from './app.module';

const localOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const hostnamePattern =
  /^(?=.{1,253}$)(?![\d.]+$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i;

function readProductionOrigin(frontendUrl: string | undefined): string {
  const url =
    frontendUrl && /^https:\/\/[^\s/?#@*\\]+\/?$/i.test(frontendUrl)
      ? URL.parse(frontendUrl)
      : null;
  if (!url || url.hostname.includes('*')) {
    throw new Error('FRONTEND_URL must be a single HTTPS origin in production');
  }

  return url.origin;
}

export async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  try {
    const configService = app.get(ConfigService);
    const host = configService.get<string>('HOST', '127.0.0.1').trim();
    const ipVersion = isIP(host);
    if (!ipVersion && !hostnamePattern.test(host.replace(/\.$/, ''))) {
      throw new Error(
        'HOST must be an IP address or a hostname without a port',
      );
    }

    const rawPort = configService.get<string>('PORT', '3000').trim();
    const port = Number(rawPort);
    if (!/^\d+$/.test(rawPort) || port < 1 || port > 65_535) {
      throw new Error('PORT must be an integer between 1 and 65535');
    }

    const frontendUrl = configService.get<string>('FRONTEND_URL')?.trim();
    const origins =
      configService.get<string>('NODE_ENV') === 'production'
        ? [readProductionOrigin(frontendUrl)]
        : [
            ...new Set(
              frontendUrl ? [frontendUrl, ...localOrigins] : localOrigins,
            ),
          ];

    app.enableShutdownHooks();
    app.setGlobalPrefix('api');
    app.enableCors({ origin: origins });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    setupApiDocs(app);
    await app.listen(port, host);

    const address = `http://${ipVersion === 6 ? `[${host}]` : host}:${port}`;
    logger.log(`API: ${address}/api`);
    logger.log(`Health: ${address}/api/health`);
    logger.log(`Swagger: ${address}/api/docs`);
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}

if (require.main === module) {
  void bootstrap();
}
