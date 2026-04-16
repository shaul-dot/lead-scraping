import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { UploadService } from './upload.service';
import { createLogger } from '../common/logger';

const logger = createLogger('upload-processor');

@Processor('upload')
export class UploadProcessor extends WorkerHost {
  constructor(private readonly uploadService: UploadService) {
    super();
  }

  async process(job: Job<{ leadId: string }>): Promise<any> {
    const { leadId } = job.data;
    logger.info({ jobId: job.id, leadId }, 'Processing upload job');

    try {
      const result = await this.uploadService.uploadLead(leadId);
      logger.info(
        { jobId: job.id, leadId, success: result.success, instantlyLeadId: result.instantlyLeadId },
        'Upload job completed',
      );
      return result;
    } catch (err) {
      logger.error({ jobId: job.id, leadId, err }, 'Upload job failed');
      throw err;
    }
  }
}
