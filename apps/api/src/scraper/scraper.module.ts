import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { InstagramScraperService } from './instagram.service';
import { InstagramProcessor } from './instagram.processor';
import { FacebookAdsProcessor } from './facebook-ads.processor';
import { StatsModule } from '../stats/stats.module';
import { IgEnrichProcessor } from './ig-enrich.processor';
import { IgGraphTraversalService } from './ig-graph-traversal.service';
import { IgGoogleNicheService } from './ig-google-niche.service';
import { IgGoogleFunnelService } from './ig-google-funnel.service';
import { IgGoogleAggregatorService } from './ig-google-aggregator.service';
import { IgHashtagNicheService } from './ig-hashtag-niche.service';

@Module({
  imports: [QueueModule, StatsModule],
  providers: [
    InstagramScraperService,
    InstagramProcessor,
    FacebookAdsProcessor,
    IgEnrichProcessor,
    IgGraphTraversalService,
    IgGoogleNicheService,
    IgGoogleFunnelService,
    IgGoogleAggregatorService,
    IgHashtagNicheService,
  ],
  exports: [
    InstagramScraperService,
    IgGoogleNicheService,
    IgGoogleFunnelService,
    IgGoogleAggregatorService,
    IgHashtagNicheService,
  ],
})
export class ScraperModule {}
