import { Module } from '@nestjs/common';
import { SourceService } from './source.service';
import { SourceController } from './source.controller';
import { AlertModule } from '../alert/alert.module';
import { QueueModule } from '../queues/queue.module';

@Module({
  imports: [AlertModule, QueueModule],
  providers: [SourceService],
  controllers: [SourceController],
  exports: [SourceService],
})
export class SourceModule {}
