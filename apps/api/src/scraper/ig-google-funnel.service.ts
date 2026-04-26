import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { BrightDataClient } from '@hyperscale/adapters/brightdata';
import { normalizeInstagramHandle } from '@hyperscale/adapters/utils/normalize-platform-handles';
import { QueueService } from '../queues/queue.service';
import { createLogger } from '../common/logger';

const logger = createLogger('ig-google-funnel');

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

  if (segments.length !== 1) return null;

  const candidate = segments[0]!;
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
export class IgGoogleFunnelService {
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
   * Run one cycle of niche×funnel discovery.
   * - Picks N niche keywords + N funnel keywords (oldest lastUsedAt first)
   * - Pairs them (i-th niche with i-th funnel)
   * - Runs SERP via Bright Data
   * - Inserts candidates from profile URLs, enqueues enrich jobs
   */
  async runOneCycle(
    combinationCount: number,
    country?: string,
  ): Promise<{
    combinationsUsed: number;
    totalResultsReturned: number;
    candidatesEnqueued: number;
    candidatesSkippedDuplicates: number;
  }> {
    const niches = await prisma.keyword.findMany({
      where: { enabled: true, patternHint: 'niche' },
      orderBy: [{ lastUsedAt: { sort: 'asc', nulls: 'first' } }],
      take: combinationCount,
      select: { id: true, primary: true },
    });

    const funnels = await prisma.keyword.findMany({
      where: { enabled: true, patternHint: 'funnel' },
      orderBy: [{ lastUsedAt: { sort: 'asc', nulls: 'first' } }],
      take: combinationCount,
      select: { id: true, primary: true },
    });

    if (niches.length === 0 || funnels.length === 0) {
      logger.warn({ niches: niches.length, funnels: funnels.length }, 'Insufficient keywords');
      return {
        combinationsUsed: 0,
        totalResultsReturned: 0,
        candidatesEnqueued: 0,
        candidatesSkippedDuplicates: 0,
      };
    }

    this.ensureClient();
    if (!this.brightData) throw new Error('Bright Data client not initialized');

    const pairCount = Math.min(niches.length, funnels.length);
    const pairs = Array.from({ length: pairCount }, (_, i) => ({
      niche: niches[i]!,
      funnel: funnels[i]!,
    }));

    logger.info({ pairCount }, 'Starting IG Google funnel discovery cycle');

    const usedKeywordIds = [
      ...niches.slice(0, pairCount).map((n) => n.id),
      ...funnels.slice(0, pairCount).map((f) => f.id),
    ];

    await prisma.keyword.updateMany({
      where: { id: { in: usedKeywordIds } },
      data: { lastUsedAt: new Date() },
    });

    const queries = pairs.map(
      (p) =>
        `site:instagram.com -inurl:/p/ -inurl:/reel/ -inurl:/explore/ -inurl:/stories/ "${p.niche.primary}" "${p.funnel.primary}"`,
    );

    let results: any[] = [];
    try {
      results = await this.brightData.googleSearch(
        queries,
        country ? { country } : undefined,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error({ err: message }, 'Bright Data Google SERP failed');
      return {
        combinationsUsed: pairCount,
        totalResultsReturned: 0,
        candidatesEnqueued: 0,
        candidatesSkippedDuplicates: 0,
      };
    }

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
            discoveryChannel: 'BRIGHTDATA_GOOGLE_FUNNEL',
            sourceMetadata: {
              query: (r as any).keyword ?? (r as any).query ?? null,
              title: (r as any).title ?? null,
              description: (r as any).description ?? null,
              rank: (r as any).rank ?? null,
              rotationCountry: country ?? null,
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
        combinationsUsed: pairCount,
        totalResultsReturned: results.length,
        candidatesEnqueued,
        candidatesSkippedDuplicates,
      },
      'IG Google funnel discovery cycle complete',
    );

    return {
      combinationsUsed: pairCount,
      totalResultsReturned: results.length,
      candidatesEnqueued,
      candidatesSkippedDuplicates,
    };
  }
}

