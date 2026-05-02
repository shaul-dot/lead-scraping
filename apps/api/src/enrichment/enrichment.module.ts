import { Module } from '@nestjs/common';
import { SnovClient } from '@hyperscale/snov';
import { QueueModule } from '../queues/queue.module';
import { BudgetModule } from '../budget/budget.module';
import { EnrichmentService } from './enrichment.service';
import { EnrichmentProcessor } from './enrichment.processor';
import { EmailEnrichmentProcessor } from './email-enrichment.processor';

@Module({
  imports: [QueueModule, BudgetModule],
  providers: [
    {
      provide: 'SNOV_CLIENT',
      useFactory: () => {
        const userId = process.env.SNOV_USER_ID;
        const secret = process.env.SNOV_SECRET;
        if (!userId || !secret) {
          console.warn('[EnrichmentModule] SNOV_USER_ID or SNOV_SECRET not set — Stage 4 will be skipped');
          return null;
        }
        return new SnovClient(userId, secret);
      },
    },
    EnrichmentService,
    EnrichmentProcessor,
    EmailEnrichmentProcessor,
  ],
  exports: [EnrichmentService],
})
export class EnrichmentModule {}
