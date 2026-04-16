import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { BudgetModule } from '../budget/budget.module';
import { ScoringService } from './scoring.service';
import { ScoringProcessor } from './scoring.processor';

@Module({
  imports: [QueueModule, BudgetModule],
  providers: [ScoringService, ScoringProcessor],
  exports: [ScoringService],
})
export class ScoringModule {}
