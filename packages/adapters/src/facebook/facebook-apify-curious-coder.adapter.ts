import { FacebookApifyAdapter, type ApifyAdResult } from './facebook-apify-adapter';

const ACTOR_ID = 'curious_coder~facebook-ads-library-scraper';

/** This actor rejects runs when charged-result caps are below 10. */
const APIFY_MIN_COUNT = 10;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function isoFromUnixField(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return new Date(v * 1000).toISOString();
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const t = v.trim();
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n)) return new Date(n * 1000).toISOString();
    }
  }
  return '';
}

/** Creative body only: root/card body text and extra_texts (not headlines/captions/CTA). */
function extractAdTextFromSnapshot(snap: Record<string, unknown>): string {
  const parts: string[] = [];

  const body =
    snap.body && typeof snap.body === 'object' ? (snap.body as Record<string, unknown>) : null;
  if (body) {
    const single = str(body.text).trim();
    if (single) {
      parts.push(single);
    } else {
      const texts = body.texts;
      if (Array.isArray(texts)) {
        const joined = texts
          .filter((t): t is string => typeof t === 'string')
          .join('\n')
          .trim();
        if (joined) parts.push(joined);
      }
    }
  }

  const cards = snap.cards;
  if (Array.isArray(cards)) {
    for (const c of cards) {
      if (!c || typeof c !== 'object') continue;
      const card = c as Record<string, unknown>;
      const cb =
        card.body && typeof card.body === 'object'
          ? (card.body as Record<string, unknown>)
          : null;
      if (cb) {
        const ct = str(cb.text).trim();
        if (ct) {
          parts.push(ct);
        } else {
          const cts = cb.texts;
          if (Array.isArray(cts)) {
            const joined = cts
              .filter((t): t is string => typeof t === 'string')
              .join('\n')
              .trim();
            if (joined) parts.push(joined);
          }
        }
      }
    }
  }

  const extras = snap.extra_texts;
  if (Array.isArray(extras)) {
    const joined = extras
      .filter((t): t is string => typeof t === 'string')
      .join('\n')
      .trim();
    if (joined) parts.push(joined);
  }

  return parts.join('\n\n').trim();
}

/**
 * Maps one Curious Coder Facebook Ads Library dataset row to {@link ApifyAdResult}.
 * Exported for unit tests; {@link FacebookApifyCuriousCoderAdapter} delegates here.
 */
export function mapCuriousCoderDatasetRow(raw: unknown): ApifyAdResult {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const snap =
    row.snapshot && typeof row.snapshot === 'object'
      ? (row.snapshot as Record<string, unknown>)
      : {};

  const adTextRaw = extractAdTextFromSnapshot(snap);
  const pageName = str(row.page_name) || str(snap.page_name);
  const pageId = str(row.page_id) || str(snap.page_id);

  const adArchive = row.ad_archive_id ?? row.ad_id;
  const adId =
    adArchive !== undefined && adArchive !== null && String(adArchive).trim() !== ''
      ? String(adArchive)
      : '';

  const linkUrl = str(snap.link_url);
  const startDate = isoFromUnixField(row.start_date) || str(row.start_date_formatted);
  const endDate = isoFromUnixField(row.end_date) || str(row.end_date_formatted);

  const targeted = row.targeted_or_reached_countries;
  const countryFromRow =
    str(snap.country_iso_code) ||
    (Array.isArray(targeted) && typeof targeted[0] === 'string' ? str(targeted[0]) : '');

  const adLibraryUrl = str(row.ad_library_url);
  const currency = str(row.currency);

  const caption = str(snap.caption);
  const title = str(snap.title);
  const linkDescription = str(snap.link_description);
  const ctaText = str(snap.cta_text);
  const ctaType = str(snap.cta_type);

  return {
    adId: adId || undefined,
    pageId: pageId || undefined,
    pageName: pageName || undefined,
    adText: adTextRaw || undefined,
    adLibraryUrl: adLibraryUrl || undefined,
    linkUrl: linkUrl || undefined,
    linkCaption: caption || undefined,
    linkTitle: title || undefined,
    linkDescription: linkDescription || undefined,
    ctaText: ctaText || undefined,
    ctaType: ctaType || undefined,
    country: countryFromRow || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    currency: currency || undefined,
  };
}

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
    return mapCuriousCoderDatasetRow(raw);
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
