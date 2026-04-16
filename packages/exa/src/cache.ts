import { createHash as cryptoCreateHash } from 'crypto';
import { prisma } from '@hyperscale/database';
import pino from 'pino';

const logger = pino({ name: 'exa-cache' });

const DEFAULT_TTL_DAYS = 30;

export function createHash(query: string, searchType: string): string {
  return cryptoCreateHash('sha256')
    .update(`${searchType}:${query}`)
    .digest('hex');
}

export async function getCached(queryHash: string): Promise<any | null> {
  try {
    const entry = await prisma.exaSearchCache.findUnique({
      where: { queryHash },
    });

    if (!entry) return null;

    if (entry.expiresAt < new Date()) {
      logger.debug({ queryHash }, 'Cache entry expired');
      return null;
    }

    logger.debug({ queryHash }, 'Cache hit');
    return entry.results;
  } catch (error) {
    logger.error({ error, queryHash }, 'Failed to read cache');
    return null;
  }
}

export async function setCache(
  queryHash: string,
  query: string,
  searchType: string,
  results: any,
  ttlDays: number = DEFAULT_TTL_DAYS,
): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    await prisma.exaSearchCache.upsert({
      where: { queryHash },
      update: { results, expiresAt },
      create: { queryHash, query, searchType, results, expiresAt },
    });

    logger.debug({ queryHash, searchType, ttlDays }, 'Cache set');
  } catch (error) {
    logger.error({ error, queryHash }, 'Failed to write cache');
  }
}

export async function clearExpired(): Promise<number> {
  try {
    const { count } = await prisma.exaSearchCache.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    logger.info({ count }, 'Cleared expired cache entries');
    return count;
  } catch (error) {
    logger.error({ error }, 'Failed to clear expired cache');
    return 0;
  }
}
