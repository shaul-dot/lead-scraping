import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { InstagramScraperService } from './instagram.service';
import { InstagramProcessor } from './instagram.processor';
import { FacebookAdsProcessor } from './facebook-ads.processor';
import { StatsModule } from '../stats/stats.module';
import { IgEnrichProcessor } from './ig-enrich.processor';
import { IgGraphTraversalService } from './ig-graph-traversal.service';

@Module({
  imports: [QueueModule, StatsModule],
  providers: [
    InstagramScraperService,
    InstagramProcessor,
    FacebookAdsProcessor,
    IgEnrichProcessor,
    IgGraphTraversalService,
  ],
  exports: [InstagramScraperService],
})
export class ScraperModule {}
