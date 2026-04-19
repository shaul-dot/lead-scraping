import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { createLogger } from '../common/logger';
import { QualificationService } from './qualification.service';

const logger = createLogger('qualification-processor');

@Processor('qualify')
export class QualificationProcessor extends WorkerHost {
  constructor(private readonly qualificationService: QualificationService) {
    super();
  }

  async process(job: Job<{ advertiserId: string }>): Promise<void> {
    const { advertiserId } = job.data;
    logger.info({ jobId: job.id, advertiserId }, 'Processing qualify job');

    await this.qualificationService.qualifyAdvertiser(advertiserId);

    logger.info({ jobId: job.id, advertiserId }, 'Qualify job completed');
  }
}
