import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { prisma } from '@hyperscale/database';
import { SnovClient } from '@hyperscale/snov';
import { createLogger } from '../common/logger';
import { mineBioText } from './stages/stage-0-bio-mining';
import { scrapeSite } from './stages/stage-1-site-scrape';
import { resolveLinktree, type Stage2Result } from './stages/stage-2-linktree-resolver';
import { searchSnovDomain } from './stages/stage-4-snov';
import { classifyEmailType, generatePatternGuesses } from './stages/stage-5-pattern-guesses';

const logger = createLogger('email-enrichment-processor');

export type EmailEnrichmentJobData = {
  knownAdvertiserId: string;
};

export const EMAIL_ENRICHMENT_QUEUE = 'email-enrichment';

function deriveLastName(fullName: string | null | undefined, firstName: string | null | undefined): string | null {
  if (!fullName?.trim() || !firstName?.trim()) return null;
  const full = fullName.trim();
  const first = firstName.trim();
  if (!full.toLowerCase().startsWith(first.toLowerCase())) return null;
  const rest = full.slice(first.length).trim();
  return rest.length > 0 ? rest : null;
}

@Injectable()
@Processor(EMAIL_ENRICHMENT_QUEUE, { concurrency: 3 })
export class EmailEnrichmentProcessor extends WorkerHost {
  constructor(
    @Inject('SNOV_CLIENT') private readonly snovClient: SnovClient | null,
  ) {
    super();
  }

  async process(job: Job<EmailEnrichmentJobData>): Promise<void> {
    const { knownAdvertiserId } = job.data;

    logger.info({ knownAdvertiserId, jobId: job.id }, 'Starting email enrichment');

    await prisma.knownAdvertiser.update({
      where: { id: knownAdvertiserId },
      data: {
        enrichmentStatus: 'IN_PROGRESS',
        enrichmentStartedAt: new Date(),
        enrichmentAttempts: { increment: 1 },
      },
    });

    const lead = await prisma.knownAdvertiser.findUnique({
      where: { id: knownAdvertiserId },
      select: {
        biography: true,
        firstName: true,
        fullName: true,
        websiteDomain: true,
        landingPageUrl: true,
      },
    });

    if (!lead) {
      throw new Error(`KnownAdvertiser not found: ${knownAdvertiserId}`);
    }

    const hadWebsiteDomain = Boolean(lead.websiteDomain);
    const stage0 = mineBioText(lead.biography, hadWebsiteDomain);

    if (stage0.promotedDomain) {
      await prisma.knownAdvertiser.update({
        where: { id: knownAdvertiserId },
        data: {
          websiteDomain: stage0.promotedDomain,
          websiteUrlOriginal: stage0.promotedUrl ?? undefined,
          landingPageUrl: stage0.promotedUrl ?? undefined,
        },
      });
    }

    if (stage0.emails.length > 0) {
      await prisma.leadEmail.createMany({
        data: stage0.emails.map((address) => ({
          leadId: knownAdvertiserId,
          address,
          source: 'BIO_TEXT',
          emailType: classifyEmailType(address),
        })),
        skipDuplicates: true,
      });
    }

    // Stage 2: Linktree resolver — only runs if we have a landingPageUrl that's
    // a platform domain (linktr.ee, beacons.ai, etc.) AND we don't already have
    // a websiteDomain. Resolves the real personal domain from the linktree page.
    let stage2: Stage2Result | null = null;
    if (lead.landingPageUrl && !lead.websiteDomain && !stage0.promotedDomain) {
      stage2 = await resolveLinktree(lead.landingPageUrl);
      logger.info(
        {
          knownAdvertiserId,
          linktreeUrl: lead.landingPageUrl,
          applicable: stage2.applicable,
          fetchSucceeded: stage2.fetchSucceeded,
          candidatesFound: stage2.candidatesFound,
          resolvedDomain: stage2.resolvedDomain,
        },
        'Stage 2 linktree resolution complete',
      );

      if (stage2.resolvedDomain) {
        await prisma.knownAdvertiser.update({
          where: { id: knownAdvertiserId },
          data: {
            websiteDomain: stage2.resolvedDomain,
            websiteUrlOriginal: lead.landingPageUrl,
            landingPageUrl: stage2.resolvedUrl ?? undefined,
          },
        });
      } else if (stage2.error) {
        logger.warn(
          { knownAdvertiserId, linktreeUrl: lead.landingPageUrl, err: stage2.error },
          'Stage 2 linktree resolution failed',
        );
      }
    }

    const effectiveDomain = lead.websiteDomain ?? stage0.promotedDomain ?? stage2?.resolvedDomain ?? null;

    if (effectiveDomain) {
      const stage1 = await scrapeSite(effectiveDomain);
      logger.info(
        {
          knownAdvertiserId,
          domain: effectiveDomain,
          stage1PagesAttempted: stage1.pagesAttempted,
          stage1PagesSucceeded: stage1.pagesSucceeded,
          stage1EmailCount: stage1.emails.length,
        },
        'Stage 1 site scrape complete',
      );
      if (stage1.emails.length > 0) {
        await prisma.leadEmail.createMany({
          data: stage1.emails.map((hit) => ({
            leadId: knownAdvertiserId,
            address: hit.address,
            source: 'SITE_SCRAPE',
            sourceDetail: hit.page,
            emailType: classifyEmailType(hit.address),
          })),
          skipDuplicates: true,
        });
      } else if (stage1.errors.length > 0) {
        logger.warn(
          { knownAdvertiserId, domain: effectiveDomain, errors: stage1.errors },
          'Stage 1 found no emails; page fetch errors occurred',
        );
      }
    }

    // Stage 4: Snov domain search.
    // Runs if we have an effectiveDomain, no emails from prior stages, and Snov is configured.
    if (effectiveDomain && this.snovClient !== null) {
      const existingEmailCount = await prisma.leadEmail.count({
        where: { leadId: knownAdvertiserId },
      });

      if (existingEmailCount === 0) {
        const stage4 = await searchSnovDomain(this.snovClient, effectiveDomain);

        logger.info(
          {
            knownAdvertiserId,
            domain: effectiveDomain,
            fetchSucceeded: stage4.fetchSucceeded,
            emailsFound: stage4.emails.length,
            creditsConsumed: stage4.creditsConsumed,
          },
          'Stage 4 Snov domain search complete',
        );

        if (stage4.emails.length > 0) {
          await prisma.leadEmail.createMany({
            data: stage4.emails.map((hit) => ({
              leadId: knownAdvertiserId,
              address: hit.address,
              source: 'SNOV',
              sourceDetail: hit.position ?? hit.snovType ?? null,
              emailType: classifyEmailType(hit.address),
            })),
            skipDuplicates: true,
          });
        }

        if (stage4.error) {
          logger.warn(
            { knownAdvertiserId, domain: effectiveDomain, err: stage4.error },
            'Stage 4 Snov call returned error',
          );
        }
      }
    }

    if (effectiveDomain) {
      const lastName = deriveLastName(lead.fullName, lead.firstName);
      const guesses = generatePatternGuesses(lead.firstName, lastName, effectiveDomain);
      if (guesses.length > 0) {
        await prisma.leadEmail.createMany({
          data: guesses.map((g) => ({
            leadId: knownAdvertiserId,
            address: g.address,
            source: 'GUESS',
            sourceDetail: g.pattern,
            emailType: classifyEmailType(g.address),
          })),
          skipDuplicates: true,
        });
      }
    }

    // TODO: Stage 3a/3b (Google SERP) — Brief 6
    // TODO: Stage 6 (Apify IG scraper) — Brief 8

    await prisma.knownAdvertiser.update({
      where: { id: knownAdvertiserId },
      data: {
        enrichmentStatus: 'COMPLETED',
        enrichmentCompletedAt: new Date(),
      },
    });

    logger.info({ knownAdvertiserId, jobId: job.id }, 'Completed email enrichment');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EmailEnrichmentJobData>, error: Error): void {
    logger.error(
      { jobId: job.id, knownAdvertiserId: job.data.knownAdvertiserId, err: error.message },
      'Email enrichment job failed',
    );
    prisma.knownAdvertiser
      .update({
        where: { id: job.data.knownAdvertiserId },
        data: {
          enrichmentStatus: 'FAILED',
          enrichmentLastError: error.message.slice(0, 500),
        },
      })
      .catch((updateErr: unknown) => {
        const msg = updateErr instanceof Error ? updateErr.message : String(updateErr);
        logger.error({ err: msg }, 'Failed to mark FAILED status after job failure');
      });
  }
}
