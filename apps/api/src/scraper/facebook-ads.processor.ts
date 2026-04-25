import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { prisma } from '@hyperscale/database';
import { QueueService } from '../queues/queue.service';
import { createLogger } from '../common/logger';
import { getActiveFacebookAdapter } from '@hyperscale/adapters';
import { normalizeDomain } from '../../../../packages/adapters/src/utils/normalize-domain';
import { isPlatformDomain } from '../../../../packages/adapters/src/utils/platform-domains';
import { StatsService } from '../stats/stats.service';

const logger = createLogger('facebook-ads-processor');
const SCRAPE_ONLY = process.env.SCRAPE_ONLY === 'true';
const QUALIFY_ONLY = process.env.QUALIFY_ONLY === 'true';

interface FacebookAdsJobData {
  keyword: string;
  maxResults?: number;
  country?: string;
}

@Processor('scrape-facebook')
export class FacebookAdsProcessor extends WorkerHost {
  constructor(
    private readonly queueService: QueueService,
    private readonly statsService: StatsService,
  ) {
    super();
  }

  async process(job: Job<FacebookAdsJobData>): Promise<any> {
    const { keyword, maxResults = 100, country } = job.data;
    logger.info(
      { jobId: job.id, keyword, maxResults, country },
      'Processing Facebook Ads scrape job',
    );
    if (SCRAPE_ONLY) {
      logger.warn(
        { jobId: job.id },
        'SCRAPE_ONLY=true — will skip downstream pipeline enqueue',
      );
    }

    const adapter = await getActiveFacebookAdapter();

    const result = await adapter.scrape(keyword, { maxResults, country });
    logger.info(
      {
        jobId: job.id,
        totalFetched: result.metadata.leadsFound,
        qualified: result.leads.length,
      },
      'Scrape complete, persisting leads',
    );

    try {
      const now = new Date();
      const totalFetched = result.metadata.leadsFound ?? result.leads.length;
      await this.statsService.incrementStat(now, 'leadsScraped', totalFetched);
      const apifyCost = totalFetched * 0.001;
      await this.statsService.incrementStat(now, 'apifyCostUsd', apifyCost);
    } catch (err) {
      logger.warn({ jobId: job.id, err }, 'Failed to track scrape stats (non-fatal)');
    }

    let created = 0;
    let skipped = 0;
    let advertisersCreated = 0;
    let advertisersExisting = 0;
    let deduplicated = 0;
    let qualifyEnqueued = 0;

    const pendingNewAdvertisers: Array<{
      advertiserId: string;
      leadId: string;
      domain: string | null;
      pageId: string | null;
    }> = [];

    for (const lead of result.leads) {
      try {
        const pageId = lead.sourceHandle?.trim();
        let existing: { id: string } | null = null;
        if (pageId) {
          existing = await prisma.lead.findFirst({
            where: {
              source: 'FACEBOOK_ADS',
              sourceHandle: pageId,
            },
            select: { id: true },
          });
        }

        if (existing) {
          logger.debug(
            { sourceHandle: lead.sourceHandle, existingId: existing.id },
            'Advertiser already scraped, skipping',
          );
          skipped++;
          continue;
        }

        const companyNameNormalized = normalizeForDedup(lead.companyName);

        let newLead: { id: string };
        let advertiserIdForQualify: string | null = null;
        let advertiserWasNew = false;

        if (pageId) {
          const outcome = await prisma.$transaction(async (tx) => {
            const prior = await tx.advertiser.findUnique({
              where: { pageId },
              select: { id: true, pageName: true },
            });
            const advertiser = await tx.advertiser.upsert({
              where: { pageId },
              create: {
                pageId,
                pageName: lead.companyName ?? '(unknown)',
                status: 'UNQUALIFIED',
              },
              update: {
                pageName: lead.companyName ?? prior?.pageName ?? '(unknown)',
              },
            });
            const leadRow = await tx.lead.create({
              data: {
                source: 'FACEBOOK_ADS',
                status: 'RAW',
                companyName: lead.companyName,
                companyNameNormalized,
                sourceUrl: lead.sourceUrl,
                sourceHandle: lead.sourceHandle,
                adCreativeId: lead.adCreativeId,
                landingPageUrl: lead.landingPageUrl,
                facebookUrl: lead.facebookUrl,
                facebookPageUrl: lead.facebookPageUrl ?? null,
                country: lead.country,
                adText: lead.adText?.trim() || null,
                advertiserId: advertiser.id,
              },
            });
            return {
              lead: leadRow,
              advertiserId: advertiser.id,
              wasNew: prior === null,
            };
          });

          newLead = outcome.lead;
          advertiserIdForQualify = outcome.advertiserId;
          advertiserWasNew = outcome.wasNew;

          if (advertiserWasNew) advertisersCreated++;
          else advertisersExisting++;
        } else {
          newLead = await prisma.lead.create({
            data: {
              source: 'FACEBOOK_ADS',
              status: 'RAW',
              companyName: lead.companyName,
              companyNameNormalized,
              sourceUrl: lead.sourceUrl,
              sourceHandle: lead.sourceHandle,
              adCreativeId: lead.adCreativeId,
              landingPageUrl: lead.landingPageUrl,
              facebookUrl: lead.facebookUrl,
              facebookPageUrl: lead.facebookPageUrl ?? null,
              country: lead.country,
              adText: lead.adText?.trim() || null,
            },
          });
        }

        if (SCRAPE_ONLY || QUALIFY_ONLY) {
          const reason = SCRAPE_ONLY ? 'SCRAPE_ONLY=true' : 'QUALIFY_ONLY=true';
          logger.info(
            { leadId: newLead.id, sourceHandle: lead.sourceHandle, reason },
            `${reason} — skipping enqueue to dedup queue`,
          );
        } else {
          await this.queueService.addJob('dedup', { leadId: newLead.id });
        }

        if (advertiserWasNew && advertiserIdForQualify) {
          const domain = lead.landingPageUrl ? normalizeDomain(lead.landingPageUrl) : null;
          pendingNewAdvertisers.push({
            advertiserId: advertiserIdForQualify,
            leadId: newLead.id,
            domain,
            pageId: pageId ?? null,
          });
        }

        created++;
      } catch (err) {
        logger.error(
          { sourceHandle: lead.sourceHandle, err },
          'Failed to persist lead',
        );
      }
    }

    // Domain-based master list dedup for newly created advertisers (batch query).
    const uniqueDomains = [
      ...new Set(
        pendingNewAdvertisers
          .map((p) => p.domain)
          .filter((d): d is string => !!d && !isPlatformDomain(d)),
      ),
    ];

    const knownByDomain = new Map<string, string>();
    if (uniqueDomains.length > 0) {
      const known = await prisma.knownAdvertiser.findMany({
        where: { websiteDomain: { in: uniqueDomains } },
        select: { id: true, websiteDomain: true },
      });
      for (const k of known) knownByDomain.set(k.websiteDomain, k.id);
    }

    // PageId-based master list dedup for platform-domain advertisers (batch query).
    const uniquePageIds = [
      ...new Set(
        pendingNewAdvertisers
          .filter((p) => !!p.domain && isPlatformDomain(p.domain))
          .map((p) => p.pageId)
          .filter((id): id is string => !!id),
      ),
    ];

    const knownPageIdSet = new Set<string>();
    if (uniquePageIds.length > 0) {
      const known = await prisma.knownAdvertiser.findMany({
        where: { facebookPageId: { in: uniquePageIds } },
        select: { facebookPageId: true },
      });
      for (const k of known) {
        if (k.facebookPageId) knownPageIdSet.add(k.facebookPageId);
      }
    }

    for (const p of pendingNewAdvertisers) {
      if (SCRAPE_ONLY) {
        logger.info(
          { advertiserId: p.advertiserId, leadId: p.leadId },
          'SCRAPE_ONLY=true — skipping enqueue to qualify queue',
        );
        continue;
      }

      if (p.domain) {
        if (isPlatformDomain(p.domain)) {
          if (p.pageId && knownPageIdSet.has(p.pageId)) {
            await prisma.advertiser.update({
              where: { id: p.advertiserId },
              data: { status: 'ALREADY_KNOWN' },
            });
            deduplicated++;
            logger.info(
              { advertiserId: p.advertiserId, pageId: p.pageId },
              'Advertiser already known via pageId, skipping qualify',
            );
            continue;
          }

          logger.debug(
            { domain: p.domain, hasPageId: !!p.pageId },
            'Platform domain advertiser not known by pageId; proceeding to qualify',
          );
        }
        const knownId = knownByDomain.get(p.domain);
        if (knownId) {
          await prisma.advertiser.update({
            where: { id: p.advertiserId },
            data: { status: 'ALREADY_KNOWN' },
          });
          deduplicated++;
          logger.info(
            { advertiserId: p.advertiserId, domain: p.domain, knownAdvertiserId: knownId },
            'Advertiser already known, skipping qualify',
          );
          continue;
        }
      }

      await this.queueService.addJob('qualify', { advertiserId: p.advertiserId });
      qualifyEnqueued++;
      logger.info(
        { advertiserId: p.advertiserId, leadId: p.leadId },
        'Queued advertiser for qualification',
      );
    }

    logger.info(
      { jobId: job.id, total: result.leads.length, deduplicated, qualifyEnqueued },
      'Scrape complete',
    );

    try {
      const now = new Date();
      await this.statsService.incrementStat(now, 'fbLeads', advertisersCreated);
      if (deduplicated > 0) {
        await this.statsService.incrementStat(now, 'advertisersDeduped', deduplicated);
      }
    } catch (err) {
      logger.warn({ jobId: job.id, err }, 'Failed to track pipeline stats (non-fatal)');
    }

    logger.info(
      {
        jobId: job.id,
        created,
        skipped,
        advertisersCreated,
        advertisersExisting,
        keyword,
      },
      'Facebook Ads scrape job completed',
    );

    return {
      keyword,
      totalFetched: result.metadata.leadsFound,
      qualified: result.leads.length,
      created,
      skipped,
      advertisersCreated,
      advertisersExisting,
      durationMs: result.metadata.durationMs,
    };
  }
}

function normalizeForDedup(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
