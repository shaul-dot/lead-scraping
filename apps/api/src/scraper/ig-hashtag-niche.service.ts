import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { ApifyInstagramHashtagScraper } from '@hyperscale/adapters';
import { normalizeInstagramHandle } from '@hyperscale/adapters/utils/normalize-platform-handles';
import { QueueService } from '../queues/queue.service';
import { createLogger } from '../common/logger';

const logger = createLogger('ig-hashtag-niche');

export type IgHashtagCycleResult = {
  hashtagsSelected: number;
  hashtagsScraped: number;
  uniqueUsernamesFound: number;
  candidatesPersisted: number;
  candidatesAlreadyExisted: number;
  enqueueErrors: number;
};

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return raw !== 'false';
}

function truncate(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  const t = text.trim();
  if (!t) return undefined;
  return t.length <= max ? t : t.slice(0, max);
}

@Injectable()
export class IgHashtagNicheService {
  private readonly queueService: QueueService;
  private readonly hashtagScraper: ApifyInstagramHashtagScraper;

  constructor(queueService: QueueService) {
    // Avoid TS parameter-property edge cases in some runtimes (e.g. tsx execution).
    this.queueService = queueService;
    this.hashtagScraper = new ApifyInstagramHashtagScraper();
  }

  async runOneCycle(): Promise<IgHashtagCycleResult> {
    const enabled = envBool('IG_CHANNEL_5_ENABLED', true);
    if (!enabled) {
      logger.info('Channel 5 disabled, skipping');
      return {
        hashtagsSelected: 0,
        hashtagsScraped: 0,
        uniqueUsernamesFound: 0,
        candidatesPersisted: 0,
        candidatesAlreadyExisted: 0,
        enqueueErrors: 0,
      };
    }

    const hashtagsPerCycle = parsePositiveIntEnv('IG_CHANNEL_5_HASHTAGS_PER_CYCLE', 30);
    const postsPerHashtag = parsePositiveIntEnv('IG_CHANNEL_5_POSTS_PER_HASHTAG', 100);

    const picked = await prisma.hashtag.findMany({
      where: { enabled: true },
      orderBy: [{ lastUsedAt: 'asc' }],
      take: hashtagsPerCycle,
      select: { id: true, hashtag: true, category: true },
    });

    if (picked.length === 0) {
      logger.warn('No enabled hashtags available');
      return {
        hashtagsSelected: 0,
        hashtagsScraped: 0,
        uniqueUsernamesFound: 0,
        candidatesPersisted: 0,
        candidatesAlreadyExisted: 0,
        enqueueErrors: 0,
      };
    }

    logger.info({ hashtags: picked.length, postsPerHashtag }, 'Starting IG Channel 5 hashtag niche cycle');

    await prisma.hashtag.updateMany({
      where: { id: { in: picked.map((p) => p.id) } },
      data: { lastUsedAt: new Date() },
    });

    const hashtagToCategory = new Map<string, string | null>(
      picked.map((p) => [p.hashtag, p.category ?? null]),
    );

    const scrapeResult = await this.hashtagScraper.scrapeHashtags({
      hashtags: picked.map((p) => p.hashtag),
      postsPerHashtag,
    });

    const bestByHandle = new Map<
      string,
      { handle: string; discoveredViaHashtag: string; postUrl?: string; caption?: string }
    >();

    for (const p of scrapeResult.posts) {
      const handle = normalizeInstagramHandle(p.ownerUsername);
      if (!handle) continue;

      if (!bestByHandle.has(handle)) {
        bestByHandle.set(handle, {
          handle,
          discoveredViaHashtag: p.hashtag,
          postUrl: p.postUrl,
          caption: p.caption,
        });
      }
    }

    const uniqueHandles = [...bestByHandle.keys()];
    let candidatesPersisted = 0;
    let candidatesAlreadyExisted = 0;
    let enqueueErrors = 0;

    for (const handle of uniqueHandles) {
      const meta = bestByHandle.get(handle);
      if (!meta) continue;

      try {
        const existing = await prisma.igCandidateProfile.findUnique({
          where: { instagramHandle: handle },
          select: { id: true },
        });
        if (existing) {
          candidatesAlreadyExisted++;
          continue;
        }

        const candidate = await prisma.igCandidateProfile.create({
          data: {
            instagramHandle: handle,
            sourceUrl: meta.postUrl ?? null,
            discoveryChannel: 'APIFY_HASHTAG_NICHE',
            sourceMetadata: {
              discoveredViaHashtag: meta.discoveredViaHashtag,
              hashtagCategory: hashtagToCategory.get(meta.discoveredViaHashtag) ?? null,
              postCaption: truncate(meta.caption, 500) ?? null,
            },
            status: 'PENDING_ENRICHMENT',
          },
          select: { id: true },
        });

        await this.queueService.addJob('enrich-ig-candidate', { candidateId: candidate.id });
        candidatesPersisted++;
      } catch (e: any) {
        if (e?.code === 'P2002' || String(e?.message ?? '').includes('Unique constraint')) {
          candidatesAlreadyExisted++;
        } else {
          const message = e instanceof Error ? e.message : String(e);
          enqueueErrors++;
          logger.warn({ handle, err: message }, 'Failed to insert/enqueue IG candidate (channel 5)');
        }
      }
    }

    const result: IgHashtagCycleResult = {
      hashtagsSelected: picked.length,
      hashtagsScraped: scrapeResult.hashtagsWithResults,
      uniqueUsernamesFound: uniqueHandles.length,
      candidatesPersisted,
      candidatesAlreadyExisted,
      enqueueErrors,
    };

    logger.info({ result }, 'IG Channel 5 hashtag niche cycle complete');
    return result;
  }
}

