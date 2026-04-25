import { Controller, Get } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { StatsService } from '../stats/stats.service';
import { BudgetService } from '../budget/budget.service';
import { SourceService } from '../source/source.service';
import type { HealthOverview, HealthStatus, TrafficLight } from '@hyperscale/types';
import Redis from 'ioredis';
import { createLogger } from '../common/logger';

const logger = createLogger('health');

@Controller('health')
export class HealthController {
  constructor(
    private readonly stats: StatsService,
    private readonly budget: BudgetService,
    private readonly source: SourceService,
  ) {}

  @Get()
  async healthCheck() {
    const checks: Record<string, string> = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }

    try {
      const redis = process.env.REDIS_URL
        ? new Redis(process.env.REDIS_URL, {
            maxRetriesPerRequest: 1,
            connectTimeout: 3000,
          })
        : new Redis({
            host: process.env.REDIS_HOST ?? 'localhost',
            port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
            password: process.env.REDIS_PASSWORD ?? undefined,
            maxRetriesPerRequest: 1,
            connectTimeout: 3000,
          });
      await redis.ping();
      await redis.quit();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    }

    const healthy = Object.values(checks).every((v) => v === 'ok');
    return { status: healthy ? 'healthy' : 'degraded', checks };
  }

  @Get('overview')
  async overview(): Promise<HealthOverview> {
    const todayNumbers = await this.stats.getTodayNumbers();
    const budgets = await this.budget.getAllBudgets();
    const sourceHealth = await this.source.getSourceHealth();

    const pipelineStatus: HealthStatus =
      todayNumbers.total.uploaded >= todayNumbers.total.target * 0.8
        ? 'green'
        : todayNumbers.total.uploaded >= todayNumbers.total.target * 0.5
          ? 'yellow'
          : 'red';

    const maxBudgetPct = Math.max(
      ...budgets.map((b) =>
        b.monthlyCapUsd > 0
          ? (b.currentUsageUsd / b.monthlyCapUsd) * 100
          : 0,
      ),
      0,
    );
    const budgetStatus: HealthStatus =
      maxBudgetPct < 80 ? 'green' : maxBudgetPct < 100 ? 'yellow' : 'red';

    const sourceValues = Object.values(sourceHealth);
    const anySourceRed = sourceValues.some((s) => !s.healthy);
    const deliverabilityStatus: HealthStatus = anySourceRed ? 'red' : 'green';

    const pipeline: TrafficLight = {
      label: 'Pipeline',
      status: pipelineStatus,
      detail: `${todayNumbers.total.uploaded}/${todayNumbers.total.target} uploaded`,
      link: '/leads',
    };
    const budgetLight: TrafficLight = {
      label: 'Budget',
      status: budgetStatus,
      detail: `Max provider at ${maxBudgetPct.toFixed(0)}%`,
      link: '/budgets',
    };
    const deliverability: TrafficLight = {
      label: 'Sources',
      status: deliverabilityStatus,
      detail: anySourceRed ? 'One or more sources unhealthy' : 'All sources healthy',
      link: '/sources',
    };
    const paperclip: TrafficLight = {
      label: 'Paperclip',
      status: 'green',
      detail: 'Autonomous agent active',
      link: '/paperclip',
    };

    return { pipeline, budget: budgetLight, deliverability, paperclip, todayNumbers };
  }

  @Get('sources')
  async sourceHealth() {
    return this.source.getSourceHealth();
  }
}
