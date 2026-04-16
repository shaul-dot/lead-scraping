import { Module } from '@nestjs/common';
import { SessionController } from './session.controller';
import { QueueModule } from '../queues/queue.module';

@Module({
  imports: [QueueModule],
  controllers: [SessionController],
})
export class SessionModule {}
