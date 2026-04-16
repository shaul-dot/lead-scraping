import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { BudgetModule } from '../budget/budget.module';
import { ReplyService } from './reply.service';
import { ReplyController } from './reply.controller';
import { ReplyClassifyProcessor } from './reply.processor';

@Module({
  imports: [QueueModule, BudgetModule],
  providers: [ReplyService, ReplyClassifyProcessor],
  controllers: [ReplyController],
  exports: [ReplyService],
})
export class ReplyModule {}
