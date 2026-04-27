import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QueueService } from '../queues/queue.service';
import { BudgetService } from '../budget/budget.service';
import { SourceService } from '../source/source.service';
import { KeywordService } from '../keyword/keyword.service';
import { DnsMonitorService } from '../deliverability/dns-monitor.service';
import { BlacklistMonitorService } from '../deliverability/blacklist-monitor.service';
import { ReputationMonitorService } from '../deliverability/reputation-monitor.service';
import { RotationService } from '../deliverability/rotation.service';
import { RemediationService } from '../remediation/remediation.service';
import { KeywordCombinatorService } from '../scraper/keyword-combinator.service';
import { IgGoogleNicheService } from '../scraper/ig-google-niche.service';
import { IgGoogleFunnelService } from '../scraper/ig-google-funnel.service';
import { IgGoogleAggregatorService } from '../scraper/ig-google-aggregator.service';
import { IgHashtagNicheService } from '../scraper/ig-hashtag-niche.service';
import { selectRotationCountry } from './country-rotation';
import {
  morningAssessment,
  middayCheck,
  eveningWrap,
  continuousMonitor,
} from '@hyperscale/paperclip';
import { prisma } from '@hyperscale/database';
import { createLogger } from '../common/logger';
import type { Source } from '@hyperscale/types';
import type { ScheduleConfig } from './schedule.controller';

const logger = createLogger('orchestrator');

const SCRAPE_CRON = process.env.SCRAPE_CRON_SCHEDULE ?? '0 */3 * * *';
const IG_CRON = process.env.IG_CRON_SCHEDULE ?? '0 */3 * * *';
const CMO_CRON = process.env.CMO_CRON_SCHEDULE ?? '0 6 * * *';

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

const SOURCES: Source[] = ['FACEBOOK_ADS', 'INSTAGRAM'];
const SOURCE_TO_QUEUE: Record<string, string> = {
  FACEBOOK_ADS: 'scrape-facebook',
  INSTAGRAM: 'scrape-instagram',
};

// Depth-aware scrape strategy.
// Deep scrape used on first encounter to maximize TAM coverage; shallow on follow-ups to catch deltas.
const DEEP_SCRAPE_MAX_RESULTS = 500; // Actor cap unknown; start conservative.
const SHALLOW_SCRAPE_MAX_RESULTS = 100;

const SCHEDULE_CACHE_KEY = 'schedule_config';

const DEFAULT_CONFIG: ScheduleConfig = {
  enabled: true,
  cronExpression: '0 6 * * *',
  dailyTarget: 500,
  sourceWeights: { FACEBOOK_ADS: 60, INSTAGRAM: 40 },
  keywordRotationEnabled: true,
  keywordMaxUses: 10,
  timezone: 'UTC',
};

@Injectable()
export class OrchestratorService {
  private readonly igHashtagNicheService: IgHashtagNicheService;

  constructor(
    private readonly queue: QueueService,
    private readonly budget: BudgetService,
    private readonly source: SourceService,
    private readonly keyword: KeywordService,
    private readonly combinator: KeywordCombinatorService,
    private readonly dnsMonitor: DnsMonitorService,
    private readonly blacklistMonitor: BlacklistMonitorService,
    private readonly reputationMonitor: ReputationMonitorService,
    private readonly rotation: RotationService,
    private readonly remediation: RemediationService,
    private readonly igGoogleNicheService: IgGoogleNicheService,
    private readonly igGoogleFunnelService: IgGoogleFunnelService,
    private readonly igGoogleAggregatorService: IgGoogleAggregatorService,
    igHashtagNicheService: IgHashtagNicheService,
  ) {
    // Avoid TS parameter-property edge cases in some runtimes (e.g. tsx execution).
    this.igHashtagNicheService = igHashtagNicheService;

    logger.info(
      {
        scrapeCron: SCRAPE_CRON,
        igCron: IG_CRON,
        cmoCron: CMO_CRON,
        maxResults: process.env.SCRAPE_MAX_RESULTS ?? '30',
        keywordsPerRun: process.env.SCRAPE_KEYWORDS_PER_RUN ?? '5',
      },
      'OrchestratorService initialized with schedule config',
    );
  }

  async runIgPipelineCycle(): Promise<{
    channel2: { keywordsUsed: number; candidatesEnqueued: number; candidatesSkippedDuplicates: number };
    channel3: { combinationsUsed: number; candidatesEnqueued: number; candidatesSkippedDuplicates: number };
    channel4: {
      keywordsUsed: number;
      candidatesEnqueued: number;
      candidatesSkippedDuplicates: number;
      handlesExtractedNone: number;
    };
    channel5: {
      hashtagsSelected: number;
      hashtagsScraped: number;
      uniqueUsernamesFound: number;
      candidatesPersisted: number;
      candidatesAlreadyExisted: number;
      enqueueErrors: number;
    };
  }> {
    if (process.env.IG_PIPELINE_ENABLED === 'false') {
      logger.info('IG pipeline disabled via IG_PIPELINE_ENABLED=false, skipping cycle');
      return {
        channel2: { keywordsUsed: 0, candidatesEnqueued: 0, candidatesSkippedDuplicates: 0 },
        channel3: { combinationsUsed: 0, candidatesEnqueued: 0, candidatesSkippedDuplicates: 0 },
        channel4: {
          keywordsUsed: 0,
          candidatesEnqueued: 0,
          candidatesSkippedDuplicates: 0,
          handlesExtractedNone: 0,
        },
        channel5: {
          hashtagsSelected: 0,
          hashtagsScraped: 0,
          uniqueUsernamesFound: 0,
          candidatesPersisted: 0,
          candidatesAlreadyExisted: 0,
          enqueueErrors: 0,
        },
      };
    }

    const country = selectRotationCountry();
    logger.info({ country }, 'Starting IG pipeline cycle');

    const c2Count = parsePositiveIntEnv('IG_CHANNEL_2_KEYWORDS_PER_CYCLE', 3);
    const c3Count = parsePositiveIntEnv('IG_CHANNEL_3_COMBINATIONS_PER_CYCLE', 3);
    const c4Count = parsePositiveIntEnv('IG_CHANNEL_4_KEYWORDS_PER_CYCLE', 2);

    const [c2Result, c3Result, c4Result, c5Result] = await Promise.allSettled([
      this.igGoogleNicheService.runOneCycle(c2Count, country),
      this.igGoogleFunnelService.runOneCycle(c3Count, country),
      this.igGoogleAggregatorService.runOneCycle(c4Count, country),
      this.igHashtagNicheService.runOneCycle(),
    ]);

    if (c2Result.status === 'rejected') {
      const message = c2Result.reason instanceof Error ? c2Result.reason.message : String(c2Result.reason);
      logger.error({ err: message }, 'IG Channel 2 failed');
    }
    if (c3Result.status === 'rejected') {
      const message = c3Result.reason instanceof Error ? c3Result.reason.message : String(c3Result.reason);
      logger.error({ err: message }, 'IG Channel 3 failed');
    }
    if (c4Result.status === 'rejected') {
      const message = c4Result.reason instanceof Error ? c4Result.reason.message : String(c4Result.reason);
      logger.error({ err: message }, 'IG Channel 4 failed');
    }
    if (c5Result.status === 'rejected') {
      const message = c5Result.reason instanceof Error ? c5Result.reason.message : String(c5Result.reason);
      logger.error({ err: message }, 'IG Channel 5 failed');
    }

    const c2 =
      c2Result.status === 'fulfilled'
        ? c2Result.value
        : { keywordsUsed: 0, candidatesEnqueued: 0, candidatesSkippedDuplicates: 0 };
    const c3 =
      c3Result.status === 'fulfilled'
        ? c3Result.value
        : { combinationsUsed: 0, candidatesEnqueued: 0, candidatesSkippedDuplicates: 0 };
    const c4 =
      c4Result.status === 'fulfilled'
        ? c4Result.value
        : {
            keywordsUsed: 0,
            totalQueries: 0,
            totalResultsReturned: 0,
            candidatesEnqueued: 0,
            candidatesSkippedDuplicates: 0,
            handlesExtractedNone: 0,
          };
    const c5 =
      c5Result.status === 'fulfilled'
        ? c5Result.value
        : {
            hashtagsSelected: 0,
            hashtagsScraped: 0,
            uniqueUsernamesFound: 0,
            candidatesPersisted: 0,
            candidatesAlreadyExisted: 0,
            enqueueErrors: 0,
          };

    logger.info(
      { country, channel2: c2, channel3: c3, channel4: c4, channel5: c5 },
      'IG pipeline cycle complete',
    );

    return {
      channel2: {
        keywordsUsed: (c2 as any).keywordsUsed ?? 0,
        candidatesEnqueued: (c2 as any).candidatesEnqueued ?? 0,
        candidatesSkippedDuplicates: (c2 as any).candidatesSkippedDuplicates ?? 0,
      },
      channel3: {
        combinationsUsed: (c3 as any).combinationsUsed ?? 0,
        candidatesEnqueued: (c3 as any).candidatesEnqueued ?? 0,
        candidatesSkippedDuplicates: (c3 as any).candidatesSkippedDuplicates ?? 0,
      },
      channel4: {
        keywordsUsed: (c4 as any).keywordsUsed ?? 0,
        candidatesEnqueued: (c4 as any).candidatesEnqueued ?? 0,
        candidatesSkippedDuplicates: (c4 as any).candidatesSkippedDuplicates ?? 0,
        handlesExtractedNone: (c4 as any).handlesExtractedNone ?? 0,
      },
      channel5: {
        hashtagsSelected: (c5 as any).hashtagsSelected ?? 0,
        hashtagsScraped: (c5 as any).hashtagsScraped ?? 0,
        uniqueUsernamesFound: (c5 as any).uniqueUsernamesFound ?? 0,
        candidatesPersisted: (c5 as any).candidatesPersisted ?? 0,
        candidatesAlreadyExisted: (c5 as any).candidatesAlreadyExisted ?? 0,
        enqueueErrors: (c5 as any).enqueueErrors ?? 0,
      },
    };
  }

  @Cron(IG_CRON, {
    name: 'ig-pipeline-cycle',
    timeZone: 'UTC',
  })
  async handleIgPipelineCron(): Promise<void> {
    try {
      const result = await this.runIgPipelineCycle();
      logger.info({ result }, 'IG cron cycle finished');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error({ err: message }, 'IG cron cycle failed');
    }
  }

  // -------------------------------------------------------------------------
  // Schedule config helpers
  // -------------------------------------------------------------------------

  private async getScheduleConfig(): Promise<ScheduleConfig> {
    const cached = await prisma.apiCache.findUnique({ where: { key: SCHEDULE_CACHE_KEY } });
    if (!cached) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...(cached.response as object) } as ScheduleConfig;
  }

  private async isScheduleEnabled(): Promise<boolean> {
    const config = await this.getScheduleConfig();
    return config.enabled;
  }

  // -------------------------------------------------------------------------
  // CMO Decision Cycles (.10.4)
  // -------------------------------------------------------------------------

  @Cron(CMO_CRON)
  async cmoMorningAssessment() {
    if (!(await this.isScheduleEnabled())) {
      logger.info('Schedule disabled — skipping morning assessment');
      return;
    }

    logger.info('Running CMO morning assessment');
    try {
      const assessment = await morningAssessment();

      if (!assessment.shouldRun) {
        logger.warn({ reasoning: assessment.reasoning }, 'CMO says DO NOT RUN today');
        return;
      }

      logger.info({ reasoning: assessment.reasoning }, 'CMO approved daily run');
      await this.runDailyPipeline(assessment.volumeAdjustment);
    } catch (err) {
      logger.error({ err }, 'CMO morning assessment failed');
    }
  }

  @Cron('0 12 * * *')
  async cmoMiddayCheck() {
    if (!(await this.isScheduleEnabled())) return;

    logger.info('Running CMO midday check');
    try {
      const status = await middayCheck();

      if (status.recommendation === 'increase_volume') {
        logger.info('Midday: increasing volume — queueing additional scrape jobs');
        await this.runDailyPipeline(20);
      } else if (status.recommendation === 'pause') {
        logger.warn('Midday: CMO recommends pause — high error rate');
      }
    } catch (err) {
      logger.error({ err }, 'CMO midday check failed');
    }
  }

  @Cron('0 20 * * *')
  async cmoEveningWrap() {
    logger.info('Running CMO evening wrap');
    try {
      await eveningWrap();
    } catch (err) {
      logger.error({ err }, 'CMO evening wrap failed');
    }
  }

  @Cron('*/15 * * * *')
  async cmoContinuousMonitor() {
    logger.info('Running CMO continuous monitor');
    try {
      const result = await continuousMonitor();

      for (const issue of result.issues) {
        if (issue.action === 'scale_concurrency') {
          logger.info({ issue }, 'Continuous monitor: would scale concurrency');
        }

        if (issue.type === 'error_spike' || issue.type === 'source_error_rate') {
          await this.remediation.handleFailure({
            trigger: issue.type === 'source_error_rate' ? 'scraper_tier_degraded' : 'unknown',
            errorMessage: issue.detail,
            metadata: { fromContinuousMonitor: true },
          });
        }
      }
    } catch (err) {
      logger.error({ err }, 'CMO continuous monitor failed');
    }
  }

  // -------------------------------------------------------------------------
  // Daily pipeline runner (used by CMO morning + forceRun)
  // -------------------------------------------------------------------------

  private async runDailyPipeline(volumeAdjustmentPct = 0): Promise<number> {
    const country = selectRotationCountry();
    logger.info({ country, volumeAdjustmentPct }, 'Starting daily pipeline run (country rotation)');
    const config = await this.getScheduleConfig();
    let totalJobs = 0;

    for (const src of SOURCES) {
      const srcKey = src === 'FACEBOOK_ADS' ? 'FACEBOOK_ADS' : 'INSTAGRAM';
      const weight = config.sourceWeights[srcKey as keyof typeof config.sourceWeights] ?? 50;
      const baseCount = Math.ceil((config.dailyTarget * weight) / 100 / 100);
      const adjustedCount = Math.max(1, Math.round(baseCount * (1 + volumeAdjustmentPct / 100)));

      const entries = await this.combinator.pickNextSearchBatch(adjustedCount);
      const queueName = SOURCE_TO_QUEUE[src];

      const queries = entries.map((e) => e.query);
      const statsRows = queries.length
        ? await prisma.scrapeQueryStats.findMany({
            where: { query: { in: queries } },
            select: { query: true, totalAdsScraped: true, isStale: true },
          })
        : [];
      const statsByQuery = new Map(statsRows.map((r) => [r.query, r]));

      const jobs = [];
      for (const entry of entries) {
        const stats = statsByQuery.get(entry.query);
        const isFirstScrape = !stats || stats.totalAdsScraped === 0;
        const isStale = stats?.isStale === true;
        if (isStale) {
          logger.warn({ query: entry.query }, 'Skipping stale query');
          continue;
        }
        const maxResults = isFirstScrape ? DEEP_SCRAPE_MAX_RESULTS : SHALLOW_SCRAPE_MAX_RESULTS;
        jobs.push({
          data: {
            keyword: entry.query,
            maxResults,
            ...(src === 'FACEBOOK_ADS' ? { country } : {}),
          },
        });
      }

      if (jobs.length > 0) {
        await this.queue.addBulk(queueName, jobs);
        totalJobs += jobs.length;
        logger.info({ source: src, jobs: jobs.length, volumeAdjustmentPct }, 'Pipeline scrape jobs queued');
      }
    }

    return totalJobs;
  }

  /**
   * Force-run the pipeline, bypassing CMO checks. Used by the "Run Now" button.
   */
  async forceRun(): Promise<{ success: boolean; jobsQueued: number }> {
    logger.info('Force run triggered — bypassing CMO checks');
    const totalJobs = await this.runDailyPipeline(0);
    return { success: true, jobsQueued: totalJobs };
  }

  // -------------------------------------------------------------------------
  // Existing cron jobs (preserved)
  // -------------------------------------------------------------------------

  @Cron('15 0 * * *')
  async overnightSummary() {
    logger.info('Running overnight Paperclip summary');
    await this.queue.addJob('paperclip-daily', {});
  }

  @Cron('0 2 * * *')
  async keywordRotation() {
    if (!(await this.isScheduleEnabled())) return;

    const config = await this.getScheduleConfig();
    if (!config.keywordRotationEnabled) {
      logger.info('Keyword rotation disabled in schedule config');
      return;
    }

    logger.info('Running keyword rotation');
    for (const src of SOURCES) {
      const sourceForApi = src === 'FACEBOOK_ADS' ? 'facebook_ads' : 'instagram';
      const topKeywords = await this.keyword.getTopKeywords(sourceForApi as Source, 20);
      logger.info(
        { source: src, count: topKeywords.length },
        'Top keywords selected',
      );
    }
  }

  @Cron(SCRAPE_CRON)
  async queueScrapeJobs() {
    if (!(await this.isScheduleEnabled())) {
      logger.info('Schedule disabled — skipping queued scrape jobs');
      return;
    }

    const country = selectRotationCountry();
    logger.info({ country }, 'Queuing scrape jobs for all sources');

    for (const src of SOURCES) {
      const keywordCount = parsePositiveIntEnv('SCRAPE_KEYWORDS_PER_RUN', 5);
      const entries = await this.combinator.pickNextSearchBatch(keywordCount);
      const queueName = SOURCE_TO_QUEUE[src];

      const queries = entries.map((e) => e.query);
      const statsRows = queries.length
        ? await prisma.scrapeQueryStats.findMany({
            where: { query: { in: queries } },
            select: { query: true, totalAdsScraped: true, isStale: true },
          })
        : [];
      const statsByQuery = new Map(statsRows.map((r) => [r.query, r]));

      const jobs = [];
      for (const entry of entries) {
        const stats = statsByQuery.get(entry.query);
        const isFirstScrape = !stats || stats.totalAdsScraped === 0;
        const isStale = stats?.isStale === true;
        if (isStale) {
          logger.warn({ query: entry.query }, 'Skipping stale query');
          continue;
        }
        const maxResults = isFirstScrape ? DEEP_SCRAPE_MAX_RESULTS : SHALLOW_SCRAPE_MAX_RESULTS;
        jobs.push({
          data: {
            keyword: entry.query,
            maxResults,
            ...(src === 'FACEBOOK_ADS' ? { country } : {}),
          },
        });
      }

      if (jobs.length > 0) {
        await this.queue.addBulk(queueName, jobs);
        logger.info(
          { source: src, jobs: jobs.length },
          'Scrape jobs queued',
        );
      }
    }
  }

  @Cron('*/30 * * * *')
  async triggerValidationBatch() {
    const count = await prisma.lead.count({ where: { status: 'VALIDATING' } });
    if (count > 0) {
      logger.info({ count }, 'Triggering NeverBounce validation batch');
      await this.queue.addJob('validate-neverbounce', { trigger: 'cron' });
    }
  }

  @Cron('*/5 * * * *')
  async pollReplies() {
    logger.info('Polling Instantly for new replies (safety net)');
    const campaigns = await prisma.campaign.findMany({
      where: { active: true, instantlyCampaignId: { not: null } },
      select: { id: true },
    });

    for (const campaign of campaigns) {
      await this.queue.addJob('reply-sync', { campaignId: campaign.id });
    }

    if (campaigns.length > 0) {
      logger.info({ count: campaigns.length }, 'Reply poll jobs queued');
    }
  }

  @Cron('*/15 * * * *')
  async paperclip15Min() {
    logger.info('Running Paperclip 15-min triage');
    await this.queue.addJob('paperclip-15min', {});
  }

  @Cron('0 * * * *')
  async hourlyTasks() {
    logger.info('Running hourly tasks');

    const campaigns = await prisma.campaign.findMany({
      where: { active: true },
    });

    for (const campaign of campaigns) {
      await this.queue.addJob('reply-sync', {
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

    await this.queue.addJob('session-health-check', { provider: 'all' });
    await this.queue.addJob('paperclip-hourly', {});
  }

  @Cron('0 */6 * * *')
  async sessionHealthChecks() {
    logger.info('Running session health checks');
    const sessions = await prisma.sessionCredential.findMany({
      where: { status: 'active' },
    });

    for (const session of sessions) {
      await this.queue.addJob('session-health-check', {
        provider: session.service,
      });
    }
  }

  @Cron('55 23 * * *')
  async dailyStatsRollup() {
    logger.info('Running daily stats rollup');
    const today = new Date().toISOString().split('T')[0];
    await this.queue.addJob('stats-rollup', { date: today });
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
      await this.queue.addJob('reply-classify', {
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
    await this.queue.addJob('paperclip-daily', {});
  }

  @Cron('0 8 * * 1')
  async paperclipWeeklyReview() {
    logger.info('Generating Paperclip weekly strategy review');
    await this.queue.addJob('paperclip-weekly', {});
  }

  @Cron('0 */6 * * *')
  async checkDns() {
    logger.info('Running DNS compliance checks');
    try {
      await this.dnsMonitor.checkAllDomains();
    } catch (err) {
      logger.error({ err }, 'DNS compliance check failed');
    }
  }

  @Cron('0 */4 * * *')
  async checkBlacklists() {
    logger.info('Running blacklist checks');
    try {
      await this.blacklistMonitor.checkAllDomains();
    } catch (err) {
      logger.error({ err }, 'Blacklist check failed');
    }
  }

  @Cron('0 */12 * * *')
  async checkReputation() {
    logger.info('Running domain reputation checks');
    try {
      await this.reputationMonitor.checkAllDomains();
    } catch (err) {
      logger.error({ err }, 'Reputation check failed');
    }
  }

  @Cron('0 * * * *')
  async checkRotation() {
    logger.info('Running inbox rotation check');
    try {
      const events = await this.rotation.checkAndRotate();
      if (events.length > 0) {
        logger.info({ eventCount: events.length }, 'Rotation events processed');
      }
    } catch (err) {
      logger.error({ err }, 'Inbox rotation check failed');
    }
  }
}
