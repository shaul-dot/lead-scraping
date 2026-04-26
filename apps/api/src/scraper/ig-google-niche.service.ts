import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { BrightDataClient } from '@hyperscale/adapters/brightdata';
import { normalizeInstagramHandle } from '@hyperscale/adapters/utils/normalize-platform-handles';
import { QueueService } from '../queues/queue.service';
import { createLogger } from '../common/logger';

const logger = createLogger('ig-google-niche');

function extractProfileHandleFromInstagramUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!(host === 'instagram.com' || host.endsWith('.instagram.com'))) return null;

  const segments = parsed.pathname
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  // profile URL is exactly "/{handle}" or "/{handle}/"
  if (segments.length !== 1) return null;

  const candidate = segments[0]!;
  // exclude obvious non-handle paths
  const reserved = new Set([
    'p',
    'reel',
    'tv',
    'stories',
    'explore',
    'accounts',
    'about',
    'developer',
    'legal',
    'press',
    'directory',
    'challenge',
    'locations',
    'tags',
  ]);
  if (reserved.has(candidate.toLowerCase())) return null;

  return normalizeInstagramHandle(candidate);
}

@Injectable()
export class IgGoogleNicheService {
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
   * Run one cycle of Google site:instagram.com niche discovery.
   * - Picks N identity keywords (oldest lastUsedAt first)
   * - Runs SERP via Bright Data (100 results/query)
   * - Extracts IG handles from profile URLs
   * - Inserts IgCandidateProfile rows + enqueues enrich jobs
   */
  async runOneCycle(keywordBatchSize: number): Promise<{
    keywordsUsed: number;
    queriesSucceeded: number;
    totalResultsReturned: number;
    candidatesEnqueued: number;
    candidatesSkippedDuplicates: number;
  }> {
    // Step A: Pick keywords — only identity-pattern, oldest lastUsedAt first
    const keywords = await prisma.keyword.findMany({
      where: {
        enabled: true,
        patternHint: 'identity',
      },
      orderBy: [{ lastUsedAt: { sort: 'asc', nulls: 'first' } }],
      take: keywordBatchSize,
      select: { id: true, primary: true, lastUsedAt: true },
    });

    if (keywords.length === 0) {
      logger.warn('No identity keywords available');
      return {
        keywordsUsed: 0,
        queriesSucceeded: 0,
        totalResultsReturned: 0,
        candidatesEnqueued: 0,
        candidatesSkippedDuplicates: 0,
      };
    }

    this.ensureClient();
    if (!this.brightData) throw new Error('Bright Data client not initialized');

    logger.info({ keywordCount: keywords.length }, 'Starting IG Google niche discovery cycle');

    // Step B: Update lastUsedAt up-front
    await prisma.keyword.updateMany({
      where: { id: { in: keywords.map((k) => k.id) } },
      data: { lastUsedAt: new Date() },
    });

    // Step C: Build queries
    const queries = keywords.map(
      (k) =>
        `site:instagram.com -inurl:/p/ -inurl:/reel/ -inurl:/explore/ -inurl:/stories/ "${k.primary}"`,
    );

    // Step D: Run Google SERP via Bright Data
    let results: any[] = [];
    try {
      results = await this.brightData.googleSearch(queries);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error({ err: message }, 'Bright Data Google SERP failed');
      return {
        keywordsUsed: keywords.length,
        queriesSucceeded: 0,
        totalResultsReturned: 0,
        candidatesEnqueued: 0,
        candidatesSkippedDuplicates: 0,
      };
    }

    logger.info({ resultsCount: results.length }, 'Bright Data returned SERP results');

    // Step E: Extract handles from URLs and enqueue
    let candidatesEnqueued = 0;
    let candidatesSkippedDuplicates = 0;

    for (const r of results) {
      const url = (r as any).link ?? (r as any).url ?? null;
      if (!url) continue;

      const handle = extractProfileHandleFromInstagramUrl(url);
      if (!handle) continue;

      try {
        const candidate = await prisma.igCandidateProfile.create({
          data: {
            instagramHandle: handle,
            sourceUrl: url,
            discoveryChannel: 'BRIGHTDATA_GOOGLE_NICHE',
            sourceMetadata: {
              query: (r as any).keyword ?? (r as any).query ?? null,
              title: (r as any).title ?? null,
              description: (r as any).description ?? null,
              rank: (r as any).rank ?? null,
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
        totalResultsReturned: results.length,
        candidatesEnqueued,
        candidatesSkippedDuplicates,
      },
      'IG Google niche discovery cycle complete',
    );

    return {
      keywordsUsed: keywords.length,
      queriesSucceeded: queries.length,
      totalResultsReturned: results.length,
      candidatesEnqueued,
      candidatesSkippedDuplicates,
    };
  }
}

