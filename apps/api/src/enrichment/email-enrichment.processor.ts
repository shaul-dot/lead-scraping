import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { prisma } from '@hyperscale/database';
import { createLogger } from '../common/logger';
import { mineBioText } from './stages/stage-0-bio-mining';
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
  constructor() {
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

    const domainForPatterns = lead.websiteDomain ?? stage0.promotedDomain;
    if (domainForPatterns) {
      const lastName = deriveLastName(lead.fullName, lead.firstName);
      const guesses = generatePatternGuesses(lead.firstName, lastName, domainForPatterns);
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

    // TODO: Stage 1 (Exa site scrape) — Brief 4
    // TODO: Stage 2 (linktree resolver) — Brief 5
    // TODO: Stage 3a/3b (Google SERP) — Brief 6
    // TODO: Stage 4 (Snov) — Brief 7
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
