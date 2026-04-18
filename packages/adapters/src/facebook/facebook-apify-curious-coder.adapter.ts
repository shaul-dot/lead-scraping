import { FacebookApifyAdapter, type ApifyAdResult } from './facebook-apify-adapter';

const ACTOR_ID = 'curious_coder~facebook-ads-library-scraper';

/** This actor rejects runs when charged-result caps are below 10. */
const APIFY_MIN_COUNT = 10;

/**
 * Apify actor `curious_coder~facebook-ads-library-scraper` — URL-based Ad Library input.
 */
export class FacebookApifyCuriousCoderAdapter extends FacebookApifyAdapter {
  protected getActorId(): string {
    return ACTOR_ID;
  }

  protected buildActorInput(
    keyword: string,
    options?: { country?: string; maxResults?: number },
  ): Record<string, unknown> {
    const requestedMax = options?.maxResults ?? 200;
    const apifyMax = Math.max(requestedMax, APIFY_MIN_COUNT);
    if (requestedMax < APIFY_MIN_COUNT) {
      this.logger.warn(
        { requestedMax, apifyMax, actor: ACTOR_ID },
        `maxResults adjusted from ${requestedMax} to ${apifyMax} (Apify actor minimum)`,
      );
    }
    const country = (options?.country ?? 'US').toUpperCase();
    const encoded = encodeURIComponent(keyword);
    const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${country}&q=${encoded}&search_type=keyword_unordered&media_type=all`;

    return {
      urls: [{ url }],
      count: apifyMax,
      limitPerSource: apifyMax,
      'scrapePageAds.countryCode': country,
      'scrapePageAds.activeStatus': 'all',
    };
  }

  protected mapDatasetItem(raw: unknown): ApifyAdResult {
    return raw as ApifyAdResult;
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      const client = await this.getClient();
      const actor = await client.actor(ACTOR_ID).get();
      if (!actor) {
        return { healthy: false, message: 'Facebook Ads Library Scraper actor not found' };
      }
      return { healthy: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { healthy: false, message };
    }
  }
}
