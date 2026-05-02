import { Module } from '@nestjs/common';
import { QualificationService } from './qualification.service';
import { QualificationProcessor } from './qualification.processor';
import { StatsModule } from '../stats/stats.module';
import { QueueModule } from '../queues/queue.module';

@Module({
  imports: [StatsModule, QueueModule],
  providers: [QualificationService, QualificationProcessor],
  exports: [QualificationService],
})
export class QualificationModule {}
