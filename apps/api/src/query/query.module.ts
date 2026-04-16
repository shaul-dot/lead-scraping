import { Module } from '@nestjs/common';
import { QueryService } from './query.service';
import { QueryController } from './query.controller';

@Module({
  providers: [QueryService],
  controllers: [QueryController],
  exports: [QueryService],
})
export class QueryModule {}
