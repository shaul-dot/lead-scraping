import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { InstagramScraperService } from './instagram.service';
import { InstagramProcessor } from './instagram.processor';
import { FacebookAdsProcessor } from './facebook-ads.processor';
import { StatsModule } from '../stats/stats.module';

@Module({
  imports: [QueueModule, StatsModule],
  providers: [
    InstagramScraperService,
    InstagramProcessor,
    FacebookAdsProcessor,
  ],
  exports: [InstagramScraperService],
})
export class ScraperModule {}
