import { prisma } from '@hyperscale/database';
import pino from 'pino';

const logger = pino({ name: 'exa-budget' });

const PROVIDER = 'exa';

// Rough cost estimate per result: ~$0.001 per search result
const COST_PER_RESULT = 0.001;
const BASE_COST_PER_SEARCH = 0.005;

const NON_CRITICAL_SEARCH_TYPES = ['personalization_context', 'keyword_discovery'];

export async function trackExaCost(searchType: string, resultCount: number): Promise<void> {
  try {
    const estimatedCost = BASE_COST_PER_SEARCH + resultCount * COST_PER_RESULT;

    await prisma.budget.upsert({
      where: { provider: PROVIDER },
      update: {
        currentUsageUsd: { increment: estimatedCost },
      },
      create: {
        provider: PROVIDER,
        monthlyCapUsd: 100,
        currentUsageUsd: estimatedCost,
        monthResetAt: getNextMonthReset(),
      },
    });

    logger.debug({ searchType, resultCount, estimatedCost }, 'Tracked Exa cost');
  } catch (error) {
    logger.error({ error, searchType }, 'Failed to track Exa cost');
  }
}

export async function isWithinBudget(): Promise<boolean> {
  try {
    const budget = await prisma.budget.findUnique({
      where: { provider: PROVIDER },
    });

    if (!budget) return true;

    if (budget.monthResetAt < new Date()) {
      await prisma.budget.update({
        where: { provider: PROVIDER },
        data: {
          currentUsageUsd: 0,
          monthResetAt: getNextMonthReset(),
        },
      });
      return true;
    }

    if (budget.hardStopAt100 && budget.currentUsageUsd >= budget.monthlyCapUsd) {
      logger.warn({ usage: budget.currentUsageUsd, cap: budget.monthlyCapUsd }, 'Exa budget hard stop reached');
      return false;
    }

    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to check Exa budget');
    return true;
  }
}

export async function shouldThrottleNonCritical(): Promise<boolean> {
  try {
    const budget = await prisma.budget.findUnique({
      where: { provider: PROVIDER },
    });

    if (!budget) return false;

    const usageRatio = budget.currentUsageUsd / budget.monthlyCapUsd;
    if (usageRatio > 0.8) {
      logger.info({ usageRatio: Math.round(usageRatio * 100) }, 'Throttling non-critical Exa searches');
      return true;
    }

    return false;
  } catch (error) {
    logger.error({ error }, 'Failed to check throttle status');
    return false;
  }
}

export { NON_CRITICAL_SEARCH_TYPES };

function getNextMonthReset(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}
