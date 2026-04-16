import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { BudgetModule } from '../budget/budget.module';
import { PersonalizationService } from './personalization.service';
import { PersonalizationProcessor } from './personalization.processor';

@Module({
  imports: [QueueModule, BudgetModule],
  providers: [PersonalizationService, PersonalizationProcessor],
  exports: [PersonalizationService],
})
export class PersonalizationModule {}
