import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { prisma } from '@hyperscale/database';
import { createLogger } from '../common/logger';

const logger = createLogger('email-enrichment-processor');

export type EmailEnrichmentJobData = {
  knownAdvertiserId: string;
};

export const EMAIL_ENRICHMENT_QUEUE = 'email-enrichment';

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

    // TODO: Stage 0 (bio mining) — Brief 3
    // TODO: Stage 1 (Exa site scrape) — Brief 4
    // TODO: Stage 2 (linktree resolver) — Brief 5
    // TODO: Stage 3a/3b (Google SERP) — Brief 6
    // TODO: Stage 4 (Snov) — Brief 7
    // TODO: Stage 5 (pattern guesses) — Brief 3
    // TODO: Stage 6 (Apify IG scraper) — Brief 8

    await prisma.knownAdvertiser.update({
      where: { id: knownAdvertiserId },
      data: {
        enrichmentStatus: 'COMPLETED',
        enrichmentCompletedAt: new Date(),
      },
    });

    logger.info({ knownAdvertiserId, jobId: job.id }, 'Completed email enrichment (no stages run yet)');
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
