import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';

@Module({
  imports: [QueueModule],
})
export class RemediationModule {}
