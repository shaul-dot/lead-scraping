import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { BrightDataClient } from '@hyperscale/adapters/brightdata';
import { extractIgHandleFromAggregatorResult } from '@hyperscale/adapters/utils/extract-instagram-handle-from-text';
import { QueueService } from '../queues/queue.service';
import { createLogger } from '../common/logger';

const logger = createLogger('ig-google-aggregator');

const AGGREGATOR_SITES = ['linktr.ee', 'beacons.ai', 'stan.store', 'bento.me'] as const;

@Injectable()
export class IgGoogleAggregatorService {
  private brightData: BrightDataClient | null = null;
  private readonly queueService: QueueService;

  constructor(queueService: QueueService) {
    // Avoid TS parameter-property edge cases in some runtimes (e.g. tsx execution).
    this.queueService = queueService;
  }

  private ensureClient(): void {
    if (this.brightData) return;
    const apiToken = process.env.BRIGHT_DATA_API_TOKEN;
    if (!apiToken) throw new Error('BRIGHT_DATA_API_TOKEN missing');
    this.brightData = new BrightDataClient({ apiToken });
  }

  /**
   * Run one cycle of aggregator-site discovery.
   * For each keyword, generates queries across all aggregator sites.
   * Total queries per cycle = keywordCount × AGGREGATOR_SITES.length
   */
  async runOneCycle(keywordCount: number): Promise<{
    keywordsUsed: number;
    totalQueries: number;
    totalResultsReturned: number;
    candidatesEnqueued: number;
    candidatesSkippedDuplicates: number;
    handlesExtractedNone: number;
  }> {
    const keywords = await prisma.keyword.findMany({
      where: { enabled: true, patternHint: 'identity' },
      orderBy: [{ lastUsedAt: { sort: 'asc', nulls: 'first' } }],
      take: keywordCount,
      select: { id: true, primary: true },
    });

    if (keywords.length === 0) {
      logger.warn('No identity keywords available');
      return {
        keywordsUsed: 0,
        totalQueries: 0,
        totalResultsReturned: 0,
        candidatesEnqueued: 0,
        candidatesSkippedDuplicates: 0,
        handlesExtractedNone: 0,
      };
    }

    this.ensureClient();
    if (!this.brightData) throw new Error('Bright Data client not initialized');

    logger.info(
      { keywordCount: keywords.length, sites: AGGREGATOR_SITES.length },
      'Starting IG Google aggregator discovery cycle',
    );

    await prisma.keyword.updateMany({
      where: { id: { in: keywords.map((k) => k.id) } },
      data: { lastUsedAt: new Date() },
    });

    const queries: string[] = [];
    for (const kw of keywords) {
      for (const site of AGGREGATOR_SITES) {
        queries.push(`site:${site} "${kw.primary}"`);
      }
    }

    let results: any[] = [];
    try {
      results = await this.brightData.googleSearch(queries);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error({ err: message }, 'Bright Data Google SERP failed');
      return {
        keywordsUsed: keywords.length,
        totalQueries: queries.length,
        totalResultsReturned: 0,
        candidatesEnqueued: 0,
        candidatesSkippedDuplicates: 0,
        handlesExtractedNone: 0,
      };
    }

    let candidatesEnqueued = 0;
    let candidatesSkippedDuplicates = 0;
    let handlesExtractedNone = 0;

    for (const r of results) {
      const url = (r as any).link ?? (r as any).url ?? null;
      const title = (r as any).title ?? null;
      const description = (r as any).description ?? null;

      const handle = extractIgHandleFromAggregatorResult({ url, title, description });
      if (!handle) {
        handlesExtractedNone++;
        continue;
      }

      try {
        const candidate = await prisma.igCandidateProfile.create({
          data: {
            instagramHandle: handle,
            sourceUrl: url,
            discoveryChannel: 'BRIGHTDATA_GOOGLE_AGGREGATOR',
            sourceMetadata: {
              query: (r as any).keyword ?? (r as any).query ?? null,
              title,
              description,
              aggregatorUrl: url,
            },
            status: 'PENDING_ENRICHMENT',
          },
          select: { id: true },
        });

        await this.queueService.addJob('enrich-ig-candidate', { candidateId: candidate.id });
        candidatesEnqueued++;
      } catch (e: any) {
        if (e?.code === 'P2002' || String(e?.message ?? '').includes('Unique constraint')) {
          candidatesSkippedDuplicates++;
        } else {
          const message = e instanceof Error ? e.message : String(e);
          logger.warn({ handle, err: message }, 'Failed to enqueue candidate');
        }
      }
    }

    logger.info(
      {
        keywordsUsed: keywords.length,
        totalQueries: queries.length,
        totalResultsReturned: results.length,
        candidatesEnqueued,
        candidatesSkippedDuplicates,
        handlesExtractedNone,
      },
      'IG Google aggregator discovery cycle complete',
    );

    return {
      keywordsUsed: keywords.length,
      totalQueries: queries.length,
      totalResultsReturned: results.length,
      candidatesEnqueued,
      candidatesSkippedDuplicates,
      handlesExtractedNone,
    };
  }
}

