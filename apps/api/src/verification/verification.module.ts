import { Module } from '@nestjs/common';
import { NeverBounceClient } from '@hyperscale/neverbounce';
import { BouncebanClient } from '@hyperscale/bounceban';
import { QueueModule } from '../queues/queue.module';
import { VerificationProcessor } from './verification.processor';
import { VerificationOrchestratorService } from './verification-orchestrator.service';

@Module({
  imports: [QueueModule],
  providers: [
    {
      provide: 'NEVERBOUNCE_CLIENT',
      useFactory: () => {
        const apiKey = process.env.NEVERBOUNCE_API_KEY;
        if (!apiKey) {
          console.warn('[VerificationModule] NEVERBOUNCE_API_KEY not set');
          return null;
        }
        return new NeverBounceClient({ apiKey });
      },
    },
    {
      provide: 'BOUNCEBAN_CLIENT',
      useFactory: () => {
        const apiKey = process.env.BOUNCEBAN_API_KEY;
        if (!apiKey) {
          console.warn('[VerificationModule] BOUNCEBAN_API_KEY not set');
          return null;
        }
        return new BouncebanClient({ apiKey });
      },
    },
    VerificationProcessor,
    VerificationOrchestratorService,
  ],
})
export class VerificationModule {}
