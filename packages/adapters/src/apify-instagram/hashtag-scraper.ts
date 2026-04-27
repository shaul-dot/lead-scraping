import { ApifyClient } from 'apify-client';
import pino from 'pino';
import { getServiceApiKey } from '@hyperscale/sessions';

export type ApifyHashtagScrapeResult = {
  posts: Array<{
    ownerUsername: string;
    hashtag: string;
    postUrl?: string;
    caption?: string;
  }>;
  hashtagsAttempted: number;
  hashtagsWithResults: number;
  apifyRunId?: string;
};

const ACTOR_ID = 'apify/instagram-hashtag-scraper';

const logger = pino({ name: 'adapter:apify_instagram_hashtag_scraper' });

function normalizeHashtagInput(raw: string): string {
  return raw.trim().replace(/^#+/, '').toLowerCase();
}

function normalizeUsername(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase();
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export class ApifyInstagramHashtagScraper {
  private client: ApifyClient | null = null;

  private async getClient(): Promise<ApifyClient> {
    if (this.client) return this.client;

    const fromVault = await getServiceApiKey('apify');
    const token = fromVault ?? process.env.APIFY_TOKEN ?? '';

    if (!token) {
      throw new Error('No Apify token configured — add one via onboarding or set APIFY_TOKEN in .env');
    }

    this.client = new ApifyClient({ token });
    return this.client;
  }

  async scrapeHashtags(input: {
    hashtags: string[];
    postsPerHashtag: number;
  }): Promise<ApifyHashtagScrapeResult> {
    const hashtags = input.hashtags.map(normalizeHashtagInput).filter(Boolean);
    const postsPerHashtag = input.postsPerHashtag;

    if (hashtags.length === 0) {
      return { posts: [], hashtagsAttempted: 0, hashtagsWithResults: 0 };
    }

    const client = await this.getClient();

    const settled = await Promise.allSettled(
      hashtags.map(async (hashtag) => {
        try {
          const run = await client.actor(ACTOR_ID).call({
            hashtags: [hashtag],
            resultsLimit: postsPerHashtag,
            resultsType: 'posts',
          });

          const runId = run?.id ? String(run.id) : undefined;
          const datasetId = (run as any)?.defaultDatasetId as string | undefined;
          if (!datasetId) {
            logger.warn({ hashtag, runId }, 'Apify run missing defaultDatasetId');
            return { hashtag, runId, posts: [] as ApifyHashtagScrapeResult['posts'] };
          }

          const { items } = await client.dataset(datasetId).listItems();

          const posts: ApifyHashtagScrapeResult['posts'] = [];
          for (const raw of items) {
            const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
            const ownerUsername = normalizeUsername(row.ownerUsername);
            if (!ownerUsername) continue;

            const postUrl =
              str(row.postUrl) ||
              str(row.url) ||
              str(row.postURL) ||
              str(row.postLink) ||
              undefined;

            const caption = str(row.caption) || str(row.text) || undefined;

            posts.push({ ownerUsername, hashtag, postUrl, caption });
          }

          return { hashtag, runId, posts };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn({ hashtag, err: message }, 'Apify hashtag scrape failed; returning empty for this hashtag');
          return { hashtag, runId: undefined as string | undefined, posts: [] as ApifyHashtagScrapeResult['posts'] };
        }
      }),
    );

    const posts: ApifyHashtagScrapeResult['posts'] = [];
    let hashtagsWithResults = 0;
    const runIds: string[] = [];

    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      if (r.value.runId) runIds.push(r.value.runId);
      if (r.value.posts.length > 0) hashtagsWithResults++;
      posts.push(...r.value.posts);
    }

    return {
      posts,
      hashtagsAttempted: hashtags.length,
      hashtagsWithResults,
      apifyRunId: runIds.length === 1 ? runIds[0] : undefined,
    };
  }
}

