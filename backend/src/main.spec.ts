import { INestApplication, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';

describe('backend network binding', () => {
  afterEach(() => jest.restoreAllMocks());
  it('boots on IPv4 loopback only while preserving validation and localhost CORS', async () => {
    const listen = jest.fn().mockResolvedValue(undefined);
    const enableCors = jest.fn(); const useGlobalPipes = jest.fn(); const setGlobalPrefix = jest.fn();
    const config = { get: (key: string, fallback: unknown) => key === 'PORT' ? 3000 : fallback };
    const app = { enableShutdownHooks: jest.fn(), setGlobalPrefix, enableCors, useGlobalPipes, listen,
      get: (token: unknown) => token === ConfigService ? config : undefined } as unknown as INestApplication;
    jest.spyOn(NestFactory, 'create').mockResolvedValue(app);
    jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue({ openapi: '3.0.0', info: { title: 'QA', version: '1' }, paths: {} });
    jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.requireActual('./main'); await new Promise(resolve => setImmediate(resolve));
    expect(listen).toHaveBeenCalledWith(3000, '127.0.0.1');
    expect(enableCors).toHaveBeenCalledWith({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] });
    expect(useGlobalPipes).toHaveBeenCalledTimes(1); expect(setGlobalPrefix).toHaveBeenCalledWith('api');
  });
});
