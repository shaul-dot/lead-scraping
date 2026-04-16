import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { InstagramTier3Adapter, type RawInstagramProfile } from '@hyperscale/adapters';
import { createLogger } from '../common/logger';

const logger = createLogger('instagram-scraper-service');

export interface InstagramScrapeResult {
  jobId: string;
  leadsCreated: number;
  profilesChecked: number;
  durationMs: number;
  errors: string[];
}

@Injectable()
export class InstagramScraperService {
  async scrapeKeyword(
    keyword: string,
    maxResults: number = 100,
  ): Promise<InstagramScrapeResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let leadsCreated = 0;

    const adapter = new InstagramTier3Adapter();

    try {
      const result = await adapter.scrape(keyword, { maxResults });

      for (const lead of result.leads) {
        try {
          const normalized = lead.companyName
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();

          const existing = await prisma.lead.findFirst({
            where: {
              OR: [
                { sourceHandle: lead.sourceHandle },
                { instagramUrl: lead.instagramUrl },
                {
                  companyNameNormalized: normalized,
                  source: 'INSTAGRAM',
                },
              ],
            },
          });

          if (existing) {
            logger.debug(
              { handle: lead.sourceHandle, existingId: existing.id },
              'Duplicate lead — skipping',
            );
            continue;
          }

          const created = await prisma.lead.create({
            data: {
              companyName: lead.companyName,
              companyNameNormalized: normalized,
              source: 'INSTAGRAM',
              status: 'RAW',
              sourceUrl: lead.sourceUrl,
              sourceHandle: lead.sourceHandle,
              instagramUrl: lead.instagramUrl,
              landingPageUrl: lead.landingPageUrl,
              websiteUrl: lead.websiteUrl,
              fullName: lead.fullName,
              scrapedAt: new Date(),
            },
          });

          leadsCreated++;
          logger.debug({ leadId: created.id, handle: lead.sourceHandle }, 'Lead created');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to create lead for @${lead.sourceHandle}: ${message}`);
          logger.warn({ handle: lead.sourceHandle, err: message }, 'Lead creation failed');
        }
      }

      logger.info(
        { keyword, leadsCreated, profilesChecked: result.metadata.leadsFound },
        'Instagram scrape completed',
      );

      return {
        jobId: '',
        leadsCreated,
        profilesChecked: result.metadata.leadsFound,
        durationMs: Date.now() - startTime,
        errors,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ keyword, err: message }, 'Instagram scrape failed');
      return {
        jobId: '',
        leadsCreated,
        profilesChecked: 0,
        durationMs: Date.now() - startTime,
        errors: [message],
      };
    }
  }
}
