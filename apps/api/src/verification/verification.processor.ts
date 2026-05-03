import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { prisma, Prisma } from '@hyperscale/database';
import { NeverBounceClient } from '@hyperscale/neverbounce';
import { BouncebanClient } from '@hyperscale/bounceban';
import { createLogger } from '../common/logger';
import { cascadeVerify } from './cascade-verify';
import { rankVerifiedEmails } from './rank-verified-emails';

export type VerificationJobData = {
  knownAdvertiserId: string;
};

export const VERIFICATION_QUEUE = 'verification';

@Processor(VERIFICATION_QUEUE, { concurrency: 5 })
@Injectable()
export class VerificationProcessor extends WorkerHost {
  private readonly log = createLogger('verification-processor');

  constructor(
    @Inject('NEVERBOUNCE_CLIENT') private readonly nb: NeverBounceClient | null,
    @Inject('BOUNCEBAN_CLIENT') private readonly bb: BouncebanClient | null,
  ) {
    super();
  }

  async process(job: Job<VerificationJobData>): Promise<void> {
    const { knownAdvertiserId } = job.data;
    const logger = this.log;

    logger.info({ knownAdvertiserId, jobId: job.id }, 'Starting verification');

    if (!this.nb || !this.bb) {
      logger.warn({ knownAdvertiserId }, 'Verification clients not configured, skipping');
      return;
    }

    const lead = await prisma.knownAdvertiser.findUnique({
      where: { id: knownAdvertiserId },
      select: {
        discoveryChannel: true,
        enrichmentStatus: true,
        leadEmails: {
          select: {
            id: true,
            address: true,
            source: true,
            sourceDetail: true,
            emailType: true,
            verificationStatus: true,
            verifiedAt: true,
            createdAt: true,
            leadId: true,
          },
        },
      },
    });

    if (!lead) {
      logger.warn({ knownAdvertiserId }, 'Lead not found, skipping');
      return;
    }

    if (!lead.discoveryChannel) {
      logger.warn({ knownAdvertiserId }, 'Refusing to verify legacy lead with null discoveryChannel');
      return;
    }

    if (lead.enrichmentStatus !== 'COMPLETED') {
      logger.info(
        { knownAdvertiserId, enrichmentStatus: lead.enrichmentStatus },
        'Lead enrichment not complete, skipping verification',
      );
      return;
    }

    await prisma.knownAdvertiser.update({
      where: { id: knownAdvertiserId },
      data: {
        verificationStatus: 'IN_PROGRESS',
        verificationStartedAt: new Date(),
      },
    });

    const toVerify = lead.leadEmails.filter(
      (e) => e.verificationStatus == null || e.verificationStatus === 'PENDING',
    );

    for (const email of toVerify) {
      try {
        const cascade = await cascadeVerify(this.nb, this.bb, email.address);

        for (const v of cascade.verifications) {
          await prisma.emailVerification.create({
            data: {
              leadEmailId: email.id,
              service: v.service,
              resultCode: v.resultCode,
              status: v.status,
              rawResponse:
                v.rawResponse === undefined || v.rawResponse === null
                  ? undefined
                  : (JSON.parse(JSON.stringify(v.rawResponse)) as Prisma.InputJsonValue),
              creditsCost: v.creditsCost ?? undefined,
            },
          });
        }

        await prisma.leadEmail.update({
          where: { id: email.id },
          data: {
            verificationStatus: cascade.status,
            verifiedAt: new Date(),
          },
        });

        if (cascade.error) {
          logger.warn(
            { knownAdvertiserId, email: email.address, err: cascade.error },
            'Verification had errors but completed',
          );
        }
      } catch (err) {
        logger.error(
          { knownAdvertiserId, email: email.address, err: err instanceof Error ? err.message : String(err) },
          'Verification failed for email',
        );
      }
    }

    const allEmails = await prisma.leadEmail.findMany({
      where: { leadId: knownAdvertiserId },
    });

    const ranked = rankVerifiedEmails(allEmails);

    await prisma.knownAdvertiser.update({
      where: { id: knownAdvertiserId },
      data: {
        verificationStatus: 'COMPLETED',
        verificationCompletedAt: new Date(),
        verifiedEmailCount: ranked.verifiedCount,
        emailVerifiedPrimary: ranked.primary,
        emailVerifiedSecondary: ranked.secondary,
        emailVerifiedTertiary: ranked.tertiary,
      },
    });

    logger.info(
      { knownAdvertiserId, verifiedCount: ranked.verifiedCount, primary: ranked.primary },
      'Verification complete',
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<VerificationJobData>, error: Error): void {
    this.log.error(
      { jobId: job.id, knownAdvertiserId: job.data.knownAdvertiserId, err: error.message },
      'Verification job failed',
    );
    prisma.knownAdvertiser
      .update({
        where: { id: job.data.knownAdvertiserId },
        data: {
          verificationStatus: 'FAILED',
          verificationCompletedAt: new Date(),
        },
      })
      .catch((updateErr: unknown) => {
        this.log.error({ err: String(updateErr) }, 'Failed to persist verification FAILED status');
      });
  }
}
