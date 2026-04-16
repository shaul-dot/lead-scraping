import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EnrichmentService } from './enrichment.service';
import { QueueService } from '../queues/queue.service';
import { createLogger } from '../common/logger';

const logger = createLogger('enrichment-processor');

@Processor('enrich')
export class EnrichmentProcessor extends WorkerHost {
  constructor(
    private readonly enrichmentService: EnrichmentService,
    private readonly queueService: QueueService,
  ) {
    super();
  }

  async process(job: Job<{ leadId: string }>): Promise<any> {
    const { leadId } = job.data;
    logger.info({ jobId: job.id, leadId }, 'Processing enrichment job');

    try {
      const result = await this.enrichmentService.enrichLead(leadId);
      logger.info(
        { jobId: job.id, leadId, success: result.success, providers: result.providersUsed },
        'Enrichment job completed',
      );

      if (result.success) {
        await this.queueService.addJob('score', { leadId });
        logger.info({ jobId: job.id, leadId }, 'Queued for scoring');
      }

      return result;
    } catch (err) {
      logger.error({ jobId: job.id, leadId, err }, 'Enrichment job failed');
      throw err;
    }
  }
}
