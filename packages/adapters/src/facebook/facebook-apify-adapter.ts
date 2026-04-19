import { ApifyClient } from 'apify-client';
import { BaseAdapter, type AdapterResult, type LeadInput } from '../base';
import { qualifyAd, type RawFacebookAd } from './qualify';
import { getServiceApiKey } from '@hyperscale/sessions';

/** Dataset row shape expected from Apify Facebook Ads Library actors (curious_coder family). */
export interface ApifyAdResult {
  adId?: string;
  pageId?: string;
  pageName?: string;
  adText?: string;
  /** Facebook Ad Library URL for this ad (not the landing page). */
  adLibraryUrl?: string;
  linkUrl?: string;
  linkCaption?: string;
  linkTitle?: string;
  linkDescription?: string;
  /** Snapshot CTA label (e.g. Learn more). */
  ctaText?: string;
  /** Snapshot CTA type (e.g. LEARN_MORE). */
  ctaType?: string;
  country?: string;
  startDate?: string;
  endDate?: string;
  currency?: string;
  spendLower?: number;
  spendUpper?: number;
  impressionsLower?: number;
  impressionsUpper?: number;
}

/**
 * Base for Tier 2 Facebook scraping via Apify. Each concrete class targets one actor:
 * implements input shape, dataset row mapping, and actor id; shared orchestration lives here.
 */
export abstract class FacebookApifyAdapter extends BaseAdapter {
  private client: ApifyClient | null = null;

  constructor() {
    super('facebook_ads');
  }

  protected async getClient(): Promise<ApifyClient> {
    if (this.client) return this.client;

    const fromVault = await getServiceApiKey('apify');
    const token = fromVault ?? process.env.APIFY_TOKEN ?? '';

    if (!token) {
      throw new Error(
        'No Apify token configured — add one via onboarding or set APIFY_TOKEN in .env',
      );
    }

    this.client = new ApifyClient({ token });
    return this.client;
  }

  protected abstract getActorId(): string;

  protected abstract buildActorInput(
    keyword: string,
    options?: { country?: string; maxResults?: number },
  ): Record<string, unknown>;

  protected abstract mapDatasetItem(raw: unknown): ApifyAdResult;

  async scrape(
    keyword: string,
    options?: { country?: string; maxResults?: number },
  ): Promise<AdapterResult> {
    const maxResults = options?.maxResults ?? 200;
    const country = (options?.country ?? 'US').toUpperCase();
    const tier = 'tier2';
    const startTime = Date.now();
    const jobId = await this.createScrapeJob(keyword, tier);

    try {
      this.logger.info({ keyword, country, maxResults }, 'Starting Facebook Tier 2 (Apify) scrape');

      const client = await this.getClient();
      const input = this.buildActorInput(keyword, options);
      const run = await client.actor(this.getActorId()).call(input);

      this.logger.info({ runId: run.id }, 'Apify run started, waiting for completion');

      const { items } = await client.dataset(run.defaultDatasetId).listItems();

      this.logger.info({ totalItems: items.length }, 'Apify run completed');

      const leads: LeadInput[] = [];
      const rejectionCounts = new Map<string, number>();

      for (const raw of items) {
        if (leads.length >= maxResults) break;

        const item = this.mapDatasetItem(raw);
        const rawAd = this.mapToRawAd(item, country);
        const qualification = qualifyAd(rawAd);

        if (!qualification.qualified) {
          const key = qualification.reason ?? 'unknown';
          rejectionCounts.set(key, (rejectionCounts.get(key) ?? 0) + 1);
          continue;
        }

        leads.push(this.mapToLead(rawAd));
      }

      const { rejectedByReason, otherRejected } = summarizeRejections(rejectionCounts);

      const result: AdapterResult = {
        leads,
        metadata: {
          source: this.source,
          tier,
          keyword,
          leadsFound: items.length,
          costEstimate: this.estimateCost(items.length),
          durationMs: Date.now() - startTime,
          rejectedByReason,
          otherRejected,
        },
      };

      await this.completeScrapeJob(jobId, result);
      this.logger.info({ leadsFound: leads.length }, 'Tier 2 scrape completed');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ error: message, keyword }, 'Tier 2 scrape failed');
      await this.failScrapeJob(jobId, message);
      throw error;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      const client = await this.getClient();
      const actor = await client.actor(this.getActorId()).get();
      if (!actor) {
        return { healthy: false, message: 'Apify actor not found' };
      }
      return { healthy: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { healthy: false, message };
    }
  }

  private mapToRawAd(item: ApifyAdResult, country: string): RawFacebookAd {
    const bodies = item.adText ? [item.adText] : [];
    const titles = item.linkTitle ? [item.linkTitle] : [];
    const descriptions = item.linkDescription ? [item.linkDescription] : [];

    return {
      pageId: item.pageId ?? '',
      pageName: item.pageName ?? '',
      adCreativeId: item.adId ?? '',
      adText: [...bodies, ...titles, ...descriptions].join(' '),
      adCreativeBodies: bodies,
      adCreativeLinkTitles: titles,
      adCreativeLinkDescriptions: descriptions,
      landingPageUrl: item.linkUrl ?? '',
      adSnapshotUrl: item.adLibraryUrl ?? '',
      adDeliveryStopTime: item.endDate ?? null,
      country: item.country ?? country,
      startDate: item.startDate ?? '',
    };
  }

  private mapToLead(ad: RawFacebookAd): LeadInput {
    return {
      companyName: this.normalizeCompanyName(ad.pageName),
      sourceUrl: `https://www.facebook.com/${ad.pageId}`,
      source: this.source,
      facebookUrl: `https://www.facebook.com/${ad.pageId}`,
      adCreativeId: ad.adCreativeId,
      landingPageUrl: ad.landingPageUrl,
      country: ad.country,
    };
  }

  private estimateCost(itemCount: number): number {
    return itemCount * 0.002;
  }
}

const REJECTION_SUMMARY_TOP = 8;

/** Top N reasons by count (then key order); remaining rejection counts roll into otherRejected. */
function summarizeRejections(counts: Map<string, number>): {
  rejectedByReason: Record<string, number>;
  otherRejected: number;
} {
  if (counts.size === 0) {
    return { rejectedByReason: {}, otherRejected: 0 };
  }

  const entries = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  const top = entries.slice(0, REJECTION_SUMMARY_TOP);
  const tail = entries.slice(REJECTION_SUMMARY_TOP);
  const rejectedByReason = Object.fromEntries(top);
  const otherRejected = tail.reduce((sum, [, c]) => sum + c, 0);

  return { rejectedByReason, otherRejected };
}
