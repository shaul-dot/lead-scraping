import { Controller, Get, Put, Post, Body, BadRequestException } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { QueueService } from '../queues/queue.service';
import { KeywordService } from '../keyword/keyword.service';
import { createLogger } from '../common/logger';
import type { Source } from '@hyperscale/types';

const logger = createLogger('schedule');

const CACHE_KEY = 'schedule_config';

export interface ScheduleConfig {
  enabled: boolean;
  cronExpression: string;
  dailyTarget: number;
  sourceWeights: { FACEBOOK_ADS: number; INSTAGRAM: number };
  keywordRotationEnabled: boolean;
  keywordMaxUses: number;
  timezone: string;
}

const DEFAULT_CONFIG: ScheduleConfig = {
  enabled: true,
  cronExpression: '0 6 * * *',
  dailyTarget: 500,
  sourceWeights: { FACEBOOK_ADS: 60, INSTAGRAM: 40 },
  keywordRotationEnabled: true,
  keywordMaxUses: 10,
  timezone: 'UTC',
};

const SOURCE_TO_QUEUE: Record<string, string> = {
  FACEBOOK_ADS: 'scrape:facebook',
  INSTAGRAM: 'scrape:instagram',
};

@Controller('schedule')
export class ScheduleController {
  constructor(
    private readonly queue: QueueService,
    private readonly keyword: KeywordService,
  ) {}

  @Get()
  async getConfig(): Promise<ScheduleConfig> {
    const cached = await prisma.apiCache.findUnique({ where: { key: CACHE_KEY } });
    if (!cached) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...(cached.response as object) } as ScheduleConfig;
  }

  @Put()
  async saveConfig(@Body() body: ScheduleConfig): Promise<ScheduleConfig> {
    const { sourceWeights } = body;
    if (sourceWeights && sourceWeights.FACEBOOK_ADS + sourceWeights.INSTAGRAM !== 100) {
      throw new BadRequestException('Source weights must sum to 100');
    }

    const config: ScheduleConfig = {
      enabled: body.enabled ?? DEFAULT_CONFIG.enabled,
      cronExpression: body.cronExpression ?? DEFAULT_CONFIG.cronExpression,
      dailyTarget: body.dailyTarget ?? DEFAULT_CONFIG.dailyTarget,
      sourceWeights: body.sourceWeights ?? DEFAULT_CONFIG.sourceWeights,
      keywordRotationEnabled: body.keywordRotationEnabled ?? DEFAULT_CONFIG.keywordRotationEnabled,
      keywordMaxUses: body.keywordMaxUses ?? DEFAULT_CONFIG.keywordMaxUses,
      timezone: body.timezone ?? DEFAULT_CONFIG.timezone,
    };

    await prisma.apiCache.upsert({
      where: { key: CACHE_KEY },
      create: {
        key: CACHE_KEY,
        response: config as any,
        expiresAt: new Date('2099-12-31'),
      },
      update: {
        response: config as any,
      },
    });

    logger.info({ config }, 'Schedule config saved');
    return config;
  }

  @Post('run-now')
  async runNow(): Promise<{ success: boolean; jobsQueued: number }> {
    const config = await this.getConfig();
    if (!config.enabled) {
      throw new BadRequestException('Pipeline is disabled');
    }

    let totalJobs = 0;
    const sources: Array<{ key: string; source: Source }> = [
      { key: 'FACEBOOK_ADS', source: 'facebook_ads' as Source },
      { key: 'INSTAGRAM', source: 'instagram' as Source },
    ];

    for (const { key, source } of sources) {
      const topKeywords = await this.keyword.getTopKeywords(source, 20);
      const queueName = SOURCE_TO_QUEUE[key];

      const jobs = topKeywords.map((kw) => ({
        data: { keyword: kw.primary, maxResults: 100 },
      }));

      if (jobs.length > 0) {
        await this.queue.addBulk(queueName, jobs);
        totalJobs += jobs.length;
        logger.info({ source: key, jobs: jobs.length }, 'Run-now scrape jobs queued');
      }
    }

    return { success: true, jobsQueued: totalJobs };
  }
}
