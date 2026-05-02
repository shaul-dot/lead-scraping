import { Module } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { BrightDataClient } from '@hyperscale/adapters';
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
      provide: 'BRIGHT_DATA_CLIENT',
      useFactory: () => {
        const token = process.env.BRIGHT_DATA_API_TOKEN;
        if (!token) {
          console.warn('[EnrichmentModule] BRIGHT_DATA_API_TOKEN not set — Stage 3 will be skipped');
          return null;
        }
        return new BrightDataClient({ apiToken: token });
      },
    },
    {
      provide: 'ANTHROPIC_CLIENT',
      useFactory: () => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          console.warn('[EnrichmentModule] ANTHROPIC_API_KEY not set — Stage 3a validation will be skipped');
          return null;
        }
        return new Anthropic({ apiKey });
      },
    },
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
