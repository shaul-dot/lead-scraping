import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { BudgetModule } from '../budget/budget.module';
import { EnrichmentService } from './enrichment.service';
import { EnrichmentProcessor } from './enrichment.processor';

@Module({
  imports: [QueueModule, BudgetModule],
  providers: [EnrichmentService, EnrichmentProcessor],
  exports: [EnrichmentService],
})
export class EnrichmentModule {}
