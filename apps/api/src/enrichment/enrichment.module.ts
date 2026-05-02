import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { BudgetModule } from '../budget/budget.module';
import { EnrichmentService } from './enrichment.service';
import { EnrichmentProcessor } from './enrichment.processor';
import { EmailEnrichmentProcessor } from './email-enrichment.processor';

@Module({
  imports: [QueueModule, BudgetModule],
  providers: [EnrichmentService, EnrichmentProcessor, EmailEnrichmentProcessor],
  exports: [EnrichmentService],
})
export class EnrichmentModule {}
