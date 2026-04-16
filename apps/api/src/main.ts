import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createLogger } from './common/logger';

const logger = createLogger('bootstrap');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? '*',
    credentials: true,
  });

  app.setGlobalPrefix('api');

  const port = parseInt(process.env.PORT ?? '4000', 10);
  await app.listen(port);

  logger.info({ port }, 'Hyperscale API started');
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
