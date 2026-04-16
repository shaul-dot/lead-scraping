import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DedupService } from './dedup.service';
import { createLogger } from '../common/logger';

const logger = createLogger('dedup-processor');

@Processor('dedup')
export class DedupProcessor extends WorkerHost {
  constructor(private readonly dedupService: DedupService) {
    super();
  }

  async process(job: Job<{ leadId: string }>): Promise<any> {
    const { leadId } = job.data;
    logger.info({ jobId: job.id, leadId }, 'Processing dedup job');

    try {
      const result = await this.dedupService.deduplicateLead(leadId);
      logger.info(
        { jobId: job.id, leadId, isDuplicate: result.isDuplicate, duplicateOfId: result.duplicateOfId },
        'Dedup job completed',
      );
      return result;
    } catch (err) {
      logger.error({ jobId: job.id, leadId, err }, 'Dedup job failed');
      throw err;
    }
  }
}
