import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { AlertModule } from '../alert/alert.module';
import { DedupService } from './dedup.service';
import { DedupProcessor } from './dedup.processor';

@Module({
  imports: [QueueModule, AlertModule],
  providers: [DedupService, DedupProcessor],
  exports: [DedupService],
})
export class DedupModule {}
