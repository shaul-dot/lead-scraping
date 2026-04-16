import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QueueService } from '../queues/queue.service';
import { BudgetService } from '../budget/budget.service';
import { SourceService } from '../source/source.service';
import { KeywordService } from '../keyword/keyword.service';
import { prisma } from '@hyperscale/database';
import { createLogger } from '../common/logger';
import type { Source } from '@hyperscale/types';

const logger = createLogger('orchestrator');

const SOURCES: Source[] = ['FACEBOOK_ADS', 'INSTAGRAM'];
const SOURCE_TO_QUEUE: Record<string, string> = {
  FACEBOOK_ADS: 'scrape:facebook',
  INSTAGRAM: 'scrape:instagram',
};

@Injectable()
export class OrchestratorService {
  constructor(
    private readonly queue: QueueService,
    private readonly budget: BudgetService,
    private readonly source: SourceService,
    private readonly keyword: KeywordService,
  ) {}

  @Cron('15 0 * * *')
  async overnightSummary() {
    logger.info('Running overnight Paperclip summary');
    await this.queue.addJob('paperclip:daily', {});
  }

  @Cron('0 2 * * *')
  async keywordRotation() {
    logger.info('Running keyword rotation');
    for (const src of SOURCES) {
      const topKeywords = await this.keyword.getTopKeywords(src, 20);
      logger.info(
        { source: src, count: topKeywords.length },
        'Top keywords selected',
      );
    }
  }

  @Cron('15 2 * * *')
  async queueScrapeJobs() {
    logger.info('Queuing scrape jobs for all sources');

    for (const src of SOURCES) {
      const topKeywords = await this.keyword.getTopKeywords(src, 20);
      const queueName = SOURCE_TO_QUEUE[src];

      const jobs = topKeywords.map((kw) => ({
        data: { keyword: kw.primary, maxResults: 100 },
      }));

      if (jobs.length > 0) {
        await this.queue.addBulk(queueName, jobs);
        logger.info(
          { source: src, jobs: jobs.length },
          'Scrape jobs queued',
        );
      }
    }
  }

  @Cron('*/15 * * * *')
  async paperclip15Min() {
    logger.info('Running Paperclip 15-min triage');
    await this.queue.addJob('paperclip:15min', {});
  }

  @Cron('0 * * * *')
  async hourlyTasks() {
    logger.info('Running hourly tasks');

    const campaigns = await prisma.campaign.findMany({
      where: { active: true },
    });

    for (const campaign of campaigns) {
      await this.queue.addJob('reply:sync', {
        campaignId: campaign.id,
      });
    }

    const budgets = await this.budget.getAllBudgets();
    for (const b of budgets) {
      const check = await this.budget.checkBudget(b.provider);
      if (check.usedPct >= 80) {
        logger.warn(
          { provider: b.provider, usedPct: check.usedPct },
          'Budget alert threshold reached',
        );
      }
    }

    await this.queue.addJob('session:health-check', { provider: 'all' });
    await this.queue.addJob('paperclip:hourly', {});
  }

  @Cron('0 */6 * * *')
  async sessionHealthChecks() {
    logger.info('Running session health checks');
    const sessions = await prisma.sessionCredential.findMany({
      where: { status: 'active' },
    });

    for (const session of sessions) {
      await this.queue.addJob('session:health-check', {
        provider: session.service,
      });
    }
  }

  @Cron('55 23 * * *')
  async dailyStatsRollup() {
    logger.info('Running daily stats rollup');
    const today = new Date().toISOString().split('T')[0];
    await this.queue.addJob('stats:rollup', { date: today });
  }

  @Cron('59 23 * * *')
  async classifyRemainingReplies() {
    logger.info('Classifying remaining unclassified replies');
    const unclassified = await prisma.lead.findMany({
      where: {
        emailReplied: true,
        replyClassification: 'NOT_CLASSIFIED',
        replyText: { not: null },
      },
      select: { id: true, replyText: true },
    });

    for (const lead of unclassified) {
      await this.queue.addJob('reply:classify', {
        replyId: lead.id,
        body: lead.replyText!,
        leadId: lead.id,
      });
    }

    logger.info({ count: unclassified.length }, 'Replies queued for classification');
  }

  @Cron('30 0 * * *')
  async keywordYieldRecalc() {
    logger.info('Recalculating keyword yield scores');
    await this.keyword.recalcAllScores();
  }

  @Cron('0 7 * * *')
  async paperclipDailyDigest() {
    logger.info('Generating Paperclip daily digest');
    await this.queue.addJob('paperclip:daily', {});
  }

  @Cron('0 8 * * 1')
  async paperclipWeeklyReview() {
    logger.info('Generating Paperclip weekly strategy review');
    await this.queue.addJob('paperclip:weekly', {});
  }
}
