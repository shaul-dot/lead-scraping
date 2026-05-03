import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { prisma } from '@hyperscale/database';
import { QueueService } from '../queues/queue.service';
import { createLogger } from '../common/logger';
import { VERIFICATION_QUEUE } from './verification.processor';

@Injectable()
export class VerificationOrchestratorService {
  private readonly log = createLogger('verification-orchestrator');

  constructor(private readonly queueService: QueueService) {}

  /**
   * Every 15 minutes: find leads where enrichment is COMPLETED but verification
   * hasn't started, and enqueue them for verification.
   *
   * Only program leads (discoveryChannel != null). Legacy rows are excluded in SQL.
   */
  @Cron('0 */15 * * * *')
  async enqueuePendingVerifications(): Promise<void> {
    const candidates = await prisma.knownAdvertiser.findMany({
      where: {
        enrichmentStatus: 'COMPLETED',
        verificationStatus: 'PENDING',
        discoveryChannel: { not: null },
      },
      select: { id: true },
      take: 200,
    });

    if (candidates.length === 0) {
      return;
    }

    this.log.info({ count: candidates.length }, 'Enqueueing leads for verification');

    for (const lead of candidates) {
      try {
        await this.queueService.addJob(VERIFICATION_QUEUE, {
          knownAdvertiserId: lead.id,
        });
      } catch (err) {
        this.log.error(
          { leadId: lead.id, err: err instanceof Error ? err.message : String(err) },
          'Failed to enqueue verification job',
        );
      }
    }
  }
}
