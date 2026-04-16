import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { ScheduleController } from './schedule.controller';
import { QueueModule } from '../queues/queue.module';
import { BudgetModule } from '../budget/budget.module';
import { SourceModule } from '../source/source.module';
import { KeywordModule } from '../keyword/keyword.module';

@Module({
  imports: [QueueModule, BudgetModule, SourceModule, KeywordModule],
  providers: [OrchestratorService],
  controllers: [ScheduleController],
})
export class OrchestratorModule {}
