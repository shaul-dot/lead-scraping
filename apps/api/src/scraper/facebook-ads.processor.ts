import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { prisma } from '@hyperscale/database';
import { QueueService } from '../queues/queue.service';
import { createLogger } from '../common/logger';
import { getActiveFacebookAdapter } from '@hyperscale/adapters';

const logger = createLogger('facebook-ads-processor');
const SCRAPE_ONLY = process.env.SCRAPE_ONLY === 'true';

interface FacebookAdsJobData {
  keyword: string;
  maxResults?: number;
  country?: string;
}

@Processor('scrape-facebook')
export class FacebookAdsProcessor extends WorkerHost {
  constructor(private readonly queueService: QueueService) {
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

    let created = 0;
    let skipped = 0;
    let advertisersCreated = 0;
    let advertisersExisting = 0;

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
              country: lead.country,
              adText: lead.adText?.trim() || null,
            },
          });
        }

        if (SCRAPE_ONLY) {
          logger.info(
            { leadId: newLead.id, sourceHandle: lead.sourceHandle },
            'SCRAPE_ONLY=true — skipping enqueue to dedup queue',
          );
        } else {
          await this.queueService.addJob('dedup', { leadId: newLead.id });
        }

        if (advertiserWasNew && advertiserIdForQualify) {
          if (SCRAPE_ONLY) {
            logger.info(
              {
                advertiserId: advertiserIdForQualify,
                leadId: newLead.id,
                sourceHandle: lead.sourceHandle,
              },
              'SCRAPE_ONLY=true — skipping enqueue to qualify queue',
            );
          } else {
            await this.queueService.addJob('qualify', {
              advertiserId: advertiserIdForQualify,
            });
            logger.info(
              { advertiserId: advertiserIdForQualify, leadId: newLead.id },
              'Queued advertiser for qualification',
            );
          }
        }

        created++;
      } catch (err) {
        logger.error(
          { sourceHandle: lead.sourceHandle, err },
          'Failed to persist lead',
        );
      }
    }

    logger.info(
      {
        jobId: job.id,
        created,
        skipped,
        advertisersCreated,
        advertisersExisting,
        keyword,
        rejectedByReason: result.metadata.rejectedByReason,
        otherRejected: result.metadata.otherRejected,
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
