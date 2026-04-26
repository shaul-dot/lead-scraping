import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { BrightDataClient, type BrightDataInstagramProfile } from '@hyperscale/adapters/brightdata';
import { normalizeInstagramHandle } from '@hyperscale/adapters/utils/normalize-platform-handles';
import { QueueService } from '../queues/queue.service';
import { createLogger } from '../common/logger';

const logger = createLogger('ig-graph-traversal');

@Injectable()
export class IgGraphTraversalService {
  private brightData: BrightDataClient | null = null;

  constructor(private readonly queueService: QueueService) {}

  private ensureClient(): void {
    if (this.brightData) return;
    const apiToken = process.env.BRIGHT_DATA_API_TOKEN;
    if (!apiToken) throw new Error('BRIGHT_DATA_API_TOKEN missing');
    this.brightData = new BrightDataClient({ apiToken });
  }

  /**
   * Run one cycle of graph traversal.
   * - Picks N seeds (oldest lastTraversedAt first, NULL first)
   * - Scrapes them via Bright Data
   * - Extracts related_accounts → enqueues as IgCandidateProfile (+ enqueue enrich job)
   * - Updates lastTraversedAt on the seeds
   */
  async runOneCycle(seedBatchSize: number): Promise<{
    seedsUsed: number;
    candidatesEnqueued: number;
    candidatesSkippedDuplicates: number;
    scrapeErrors: number;
  }> {
    // Step A: Pick seeds — oldest lastTraversedAt first (NULL first)
    const seeds = await prisma.knownAdvertiser.findMany({
      where: { instagramHandle: { not: null } },
      select: { id: true, instagramHandle: true, lastTraversedAt: true },
      orderBy: [{ lastTraversedAt: { sort: 'asc', nulls: 'first' } }],
      take: seedBatchSize,
    });

    if (seeds.length === 0) {
      logger.warn('No seeds available — KnownAdvertiser has no instagramHandle entries');
      return {
        seedsUsed: 0,
        candidatesEnqueued: 0,
        candidatesSkippedDuplicates: 0,
        scrapeErrors: 0,
      };
    }

    this.ensureClient();
    if (!this.brightData) throw new Error('Bright Data client not initialized');

    logger.info({ seedCount: seeds.length }, 'Starting IG graph traversal cycle');

    // Step B: Update lastTraversedAt up-front (even if scrape fails)
    const seedIds = seeds.map((s) => s.id);
    await prisma.knownAdvertiser.updateMany({
      where: { id: { in: seedIds } },
      data: { lastTraversedAt: new Date() },
    });

    // Step C: Scrape all seeds via Bright Data (batched)
    const seedUrls = seeds
      .map((s) => s.instagramHandle)
      .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
      .map((h) => `https://www.instagram.com/${h}/`);

    let profiles: BrightDataInstagramProfile[];
    try {
      profiles = await this.brightData.scrapeInstagramProfiles(seedUrls);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error({ err: message }, 'Bright Data graph scrape failed');
      return {
        seedsUsed: seeds.length,
        candidatesEnqueued: 0,
        candidatesSkippedDuplicates: 0,
        scrapeErrors: seeds.length,
      };
    }

    logger.info(
      { profilesReturned: profiles.length, seedsRequested: seeds.length },
      'Bright Data returned profiles',
    );

    // Step D: Extract related_accounts and enqueue
    let candidatesEnqueued = 0;
    let candidatesSkippedDuplicates = 0;

    for (const profile of profiles) {
      const related = profile.related_accounts ?? [];
      if (!Array.isArray(related) || related.length === 0) continue;

      for (const rel of related) {
        const handle = normalizeInstagramHandle((rel as any).account ?? (rel as any).profile_url);
        if (!handle) continue;

        try {
          const candidate = await prisma.igCandidateProfile.create({
            data: {
              instagramHandle: handle,
              sourceUrl: (rel as any).profile_url ?? null,
              discoveryChannel: 'BRIGHTDATA_GRAPH_TRAVERSAL',
              sourceMetadata: {
                seedHandle: profile.account,
                fullName: (rel as any).full_name ?? null,
                isVerified: (rel as any).is_verified ?? null,
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
    }

    logger.info(
      {
        seedsUsed: seeds.length,
        profilesScraped: profiles.length,
        candidatesEnqueued,
        candidatesSkippedDuplicates,
      },
      'IG graph traversal cycle complete',
    );

    return {
      seedsUsed: seeds.length,
      candidatesEnqueued,
      candidatesSkippedDuplicates,
      scrapeErrors: Math.max(0, seeds.length - profiles.length),
    };
  }
}

