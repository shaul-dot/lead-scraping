import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { createReauthWorker } from './reauth-worker';

const logger = pino({ name: 'scraper' });

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function main() {
  logger.info('Starting Hyperscale scraper service...');

  const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  redis.on('connect', () => logger.info('Redis connected'));
  redis.on('error', (err) => logger.error({ err }, 'Redis connection error'));

  const workers: Worker[] = [];

  const reauthWorker = createReauthWorker(redis);
  workers.push(reauthWorker);
  logger.info({ queue: 'session-auto-reauth' }, 'Registered reauth worker');

  logger.info(
    { workers: workers.length },
    'Scraper service ready — listening for jobs',
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down scraper service...');
    await Promise.all(workers.map((w) => w.close()));
    await redis.quit();
    logger.info('Scraper service stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start scraper service');
  process.exit(1);
});
