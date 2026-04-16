import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { KeywordService } from './keyword.service';
import { KeywordController } from './keyword.controller';
import { KeywordScoreProcessor } from './keyword.processor';

@Module({
  imports: [QueueModule],
  providers: [KeywordService, KeywordScoreProcessor],
  controllers: [KeywordController],
  exports: [KeywordService],
})
export class KeywordModule {}
