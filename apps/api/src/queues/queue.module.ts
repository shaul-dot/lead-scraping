import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import type { QueueName } from '@hyperscale/types';

const ALL_QUEUES: QueueName[] = [
  'scrape-facebook',
  'scrape-instagram',
  'enrich-ig-candidate',
  'enrich',
  'score',
  'dedup',
  'validate',
  'validate-neverbounce',
  'validate-bounceban',
  'personalize',
  'qa',
  'upload',
  'reply-sync',
  'reply-classify',
  'remediate',
  'session-health-check',
  'session-auto-reauth',
  'paperclip-15min',
  'paperclip-hourly',
  'paperclip-daily',
  'paperclip-weekly',
  'exa-search',
  'keyword-score',
  'stats-rollup',
  'qualify',
  'email-enrichment',
];

const queueRegistrations = ALL_QUEUES.map((name) =>
  BullModule.registerQueue({ name }),
);

@Module({
  imports: [...queueRegistrations],
  providers: [QueueService],
  exports: [QueueService, ...queueRegistrations],
})
export class QueueModule {}
