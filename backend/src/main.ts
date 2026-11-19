import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { setupApiDocs } from './api-docs';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: [
      configService.get<string>('FRONTEND_URL', 'http://localhost:5173'),
      'http://127.0.0.1:5173',
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  setupApiDocs(app);

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port, '127.0.0.1');

  logger.log(`API: http://localhost:${port}/api`);
  logger.log(`Health: http://localhost:${port}/api/health`);
  logger.log(`Swagger: http://localhost:${port}/api/docs`);
}
void bootstrap();
