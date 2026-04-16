import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { InstagramScraperService } from './instagram.service';
import { InstagramProcessor } from './instagram.processor';

@Module({
  imports: [QueueModule],
  providers: [InstagramScraperService, InstagramProcessor],
  exports: [InstagramScraperService],
})
export class ScraperModule {}
