import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { prisma } from '@hyperscale/database';
import { ScoringService } from './scoring.service';
import { createLogger } from '../common/logger';

const logger = createLogger('scoring-processor');

@Processor('score')
export class ScoringProcessor extends WorkerHost {
  constructor(private readonly scoringService: ScoringService) {
    super();
  }

  async process(job: Job<{ leadId: string }>): Promise<any> {
    const { leadId } = job.data;
    logger.info({ jobId: job.id, leadId }, 'Processing scoring job');

    try {
      const result = await this.scoringService.scoreLead(leadId);
      logger.info(
        { jobId: job.id, leadId, score: result.score, pass: result.pass },
        'Scoring job completed',
      );

      if (result.pass) {
        await prisma.lead.update({ where: { id: leadId }, data: { status: 'VALIDATING' } });
        logger.info({ jobId: job.id, leadId }, 'Lead passed scoring, set to VALIDATING for batch validation');
      }

      return result;
    } catch (err) {
      logger.error({ jobId: job.id, leadId, err }, 'Scoring job failed');
      throw err;
    }
  }
}
