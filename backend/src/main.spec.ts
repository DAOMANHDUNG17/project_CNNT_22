import { BadRequestException, INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { IsInt } from 'class-validator';
import { bootstrap } from './main';

jest.mock('./app.module', () => ({ AppModule: class AppModule {} }));

class ValidationProbe {
  @IsInt()
  count!: number;
}

const localOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const frontendOrigin = 'https://warehouse.example.test';

function mockApp(values: Record<string, string | undefined> = {}) {
  const config = {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  };
  const app = {
    enableShutdownHooks: jest.fn(),
    setGlobalPrefix: jest.fn(),
    enableCors: jest.fn(),
    useGlobalPipes: jest.fn(),
    listen: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    get: (token: unknown) => (token === ConfigService ? config : undefined),
  };
  jest
    .spyOn(NestFactory, 'create')
    .mockResolvedValue(app as unknown as INestApplication);
  return app;
}

describe('backend network binding', () => {
  beforeEach(() => {
    jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue({
      openapi: '3.0.0',
      info: { title: 'QA', version: '1' },
      paths: {},
    });
    jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('defaults to IPv4 loopback and preserves the Local bootstrap configuration', async () => {
    const app = mockApp();
    await bootstrap();

    expect(app.listen).toHaveBeenCalledWith(3000, '127.0.0.1');
    expect(app.enableCors).toHaveBeenCalledWith({ origin: localOrigins });
    expect(app.setGlobalPrefix).toHaveBeenCalledWith('api');
    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect(SwaggerModule.setup).toHaveBeenCalledWith(
      'api/docs',
      app,
      expect.any(Object),
      expect.any(Object),
    );

    expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
    const [pipe] = app.useGlobalPipes.mock.calls[0];
    const metadata = { type: 'body', metatype: ValidationProbe } as const;
    await expect(
      pipe.transform({ count: 1 }, metadata),
    ).resolves.toBeInstanceOf(ValidationProbe);
    await expect(
      pipe.transform({ count: 1, extra: true }, metadata),
    ).rejects.toThrow(BadRequestException);
    await expect(
      pipe.transform({ count: 'invalid' }, metadata),
    ).rejects.toThrow(BadRequestException);
  });

  it('preserves a configured Local frontend origin alongside both loopback origins', async () => {
    const app = mockApp({
      HOST: '127.0.0.1',
      FRONTEND_URL: 'http://dev.example.test:5173',
    });
    await bootstrap();

    expect(app.listen).toHaveBeenCalledWith(3000, '127.0.0.1');
    expect(app.enableCors).toHaveBeenCalledWith({
      origin: ['http://dev.example.test:5173', ...localOrigins],
    });
  });

  it('uses the Cloud bind address and converts the configured port to a number', async () => {
    const app = mockApp({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: ' 8081 ',
      FRONTEND_URL: 'https://warehouse.example.test:443/',
    });
    await bootstrap();

    expect(app.listen).toHaveBeenCalledWith(8081, '0.0.0.0');
    expect(app.enableCors).toHaveBeenCalledWith({ origin: [frontendOrigin] });
  });

  it.each(['', 'https://localhost', '127.0.0.1:3000', '999.0.0.1'])(
    'rejects invalid HOST before listening (case %#)',
    async (host) => {
      const app = mockApp({ HOST: host });
      await expect(bootstrap()).rejects.toThrow(
        'HOST must be an IP address or a hostname without a port',
      );
      expect(app.listen).not.toHaveBeenCalled();
      expect(app.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['', '0', '-1', '3000.5', '3e3', '0xBB8', '65536', '3000abc'])(
    'rejects invalid PORT before listening (case %#)',
    async (port) => {
      const app = mockApp({ PORT: port });
      await expect(bootstrap()).rejects.toThrow(
        'PORT must be an integer between 1 and 65535',
      );
      expect(app.listen).not.toHaveBeenCalled();
      expect(app.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    undefined,
    '',
    'http://warehouse.example.test',
    'https://*.vercel.app',
    'https://%2a.vercel.app',
    'https://warehouse.example.test/page',
    'https://warehouse.example.test/?query',
    'https://warehouse.example.test/#fragment',
    'https://account@warehouse.example.test',
    'https:warehouse.example.test',
  ])(
    'rejects invalid production FRONTEND_URL before listening (case %#)',
    async (url) => {
      const app = mockApp({ NODE_ENV: 'production', FRONTEND_URL: url });
      await expect(bootstrap()).rejects.toThrow(
        'FRONTEND_URL must be a single HTTPS origin in production',
      );
      expect(app.enableCors).not.toHaveBeenCalled();
      expect(app.listen).not.toHaveBeenCalled();
      expect(app.close).toHaveBeenCalledTimes(1);
    },
  );
});
