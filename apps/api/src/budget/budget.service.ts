import { Injectable } from '@nestjs/common';
import { prisma, type Budget } from '@hyperscale/database';
import { createLogger } from '../common/logger';

const logger = createLogger('budget');

@Injectable()
export class BudgetService {
  async trackUsage(provider: string, costUsd: number): Promise<void> {
    await prisma.budget.update({
      where: { provider },
      data: { currentUsageUsd: { increment: costUsd } },
    });
    logger.info({ provider, costUsd }, 'Usage tracked');
  }

  async checkBudget(
    provider: string,
  ): Promise<{ withinBudget: boolean; usedPct: number; remaining: number }> {
    const budget = await prisma.budget.findUniqueOrThrow({
      where: { provider },
    });
    const usedPct =
      budget.monthlyCapUsd > 0
        ? (budget.currentUsageUsd / budget.monthlyCapUsd) * 100
        : 0;
    const remaining = Math.max(
      0,
      budget.monthlyCapUsd - budget.currentUsageUsd,
    );
    return {
      withinBudget: budget.currentUsageUsd < budget.monthlyCapUsd,
      usedPct,
      remaining,
    };
  }

  async isHardStopped(provider: string): Promise<boolean> {
    const budget = await prisma.budget.findUniqueOrThrow({
      where: { provider },
    });
    return (
      budget.hardStopAt100 &&
      budget.currentUsageUsd >= budget.monthlyCapUsd
    );
  }

  async getFailoverProvider(provider: string): Promise<string | null> {
    const budget = await prisma.budget.findUniqueOrThrow({
      where: { provider },
    });
    return budget.autoSwitchTo;
  }

  async resetMonthlyBudgets(): Promise<void> {
    const now = new Date();
    await prisma.budget.updateMany({
      where: { monthResetAt: { lte: now } },
      data: {
        currentUsageUsd: 0,
        monthResetAt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      },
    });
    logger.info('Monthly budgets reset');
  }

  async getAllBudgets(): Promise<Budget[]> {
    return prisma.budget.findMany({ orderBy: { provider: 'asc' } });
  }

  async updateCap(provider: string, monthlyCapUsd: number): Promise<Budget> {
    return prisma.budget.update({
      where: { provider },
      data: { monthlyCapUsd },
    });
  }
}
