import { FacebookApifyAdapter, type ApifyAdResult } from './facebook-apify-adapter';
import pino from 'pino';

const ACTOR_ID = 'curious_coder~facebook-ads-library-scraper';

/** This actor rejects runs when charged-result caps are below 10. */
const APIFY_MIN_COUNT = 10;

const logger = pino({ name: 'adapter:facebook_apify_curious_coder' });

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

const TEMPLATE_RE = /\{\{[^}]+\}\}/g;
const SOCIAL_ROOT_RE = /^https?:\/\/(www\.)?(instagram|facebook|fb)\.(com|me)\/?$/i;
const HOSTNAME_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z]{2,})+$/i;
const GENERIC_SOCIAL_HOSTNAMES = new Set(['instagram.com', 'facebook.com', 'fb.me']);

function stripTemplatePlaceholders(text: string): { text: string; hadTemplate: boolean } {
  const hadTemplate = TEMPLATE_RE.test(text);
  TEMPLATE_RE.lastIndex = 0;
  const withoutTemplates = text.replaceAll(TEMPLATE_RE, '');
  // Preserve intentional newlines (card text often uses line breaks).
  const normalized = withoutTemplates
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .trim();
  const stripped = normalized.replace(/\n{3,}/g, '\n\n').trim();
  return { text: stripped, hadTemplate };
}

function isBareSocialRootUrl(url: string): boolean {
  return SOCIAL_ROOT_RE.test(url.trim());
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^www\./, '');
}

function looksLikeNonSocialHostname(caption: string): boolean {
  const h = normalizeHostname(caption);
  if (!HOSTNAME_RE.test(h)) return false;
  if (GENERIC_SOCIAL_HOSTNAMES.has(h)) return false;
  return true;
}

// Returns best URL available in the ad snapshot, or null
export function pickBestLandingPageUrl(snap: Record<string, unknown>): string | null {
  const direct = str(snap.link_url).trim();
  if (direct && !isBareSocialRootUrl(direct)) return direct;

  const cards = snap.cards;
  if (Array.isArray(cards)) {
    for (const c of cards) {
      if (!c || typeof c !== 'object') continue;
      const card = c as Record<string, unknown>;
      const cu = str(card.link_url).trim();
      if (cu && !isBareSocialRootUrl(cu)) return cu;
    }
  }

  const caption = str(snap.caption).trim();
  if (caption && looksLikeNonSocialHostname(caption)) {
    return `https://${normalizeHostname(caption)}/`;
  }

  return null;
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

function collectBodyLikeText(snap: Record<string, unknown>): string[] {
  const parts: string[] = [];

  const body = snap.body;
  if (typeof body === 'string') {
    const t = body.trim();
    if (t) parts.push(t);
  } else if (body && typeof body === 'object') {
    const bo = body as Record<string, unknown>;
    const single = str(bo.text).trim();
    if (single) {
      parts.push(single);
    } else if (Array.isArray(bo.texts)) {
      const joined = bo.texts.filter((t): t is string => typeof t === 'string').join('\n').trim();
      if (joined) parts.push(joined);
    }
  }

  const cards = snap.cards;
  if (Array.isArray(cards)) {
    for (const c of cards) {
      if (!c || typeof c !== 'object') continue;
      const card = c as Record<string, unknown>;
      const cb = card.body;
      if (typeof cb === 'string') {
        const t = cb.trim();
        if (t) parts.push(t);
      } else if (cb && typeof cb === 'object') {
        const cbo = cb as Record<string, unknown>;
        const ct = str(cbo.text).trim();
        if (ct) {
          parts.push(ct);
        } else if (Array.isArray(cbo.texts)) {
          const joined = cbo.texts
            .filter((t): t is string => typeof t === 'string')
            .join('\n')
            .trim();
          if (joined) parts.push(joined);
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

  return parts;
}

export function extractBestAdText(snap: Record<string, unknown>): {
  text: string;
  fallbackUsed:
    | 'body'
    | 'cards'
    | 'extra_texts'
    | 'title'
    | 'link_description'
    | 'caption'
    | 'card_title'
    | 'card_description'
    | 'card_caption'
    | 'none';
  templateDetected: boolean;
} {
  const primaryPieces = collectBodyLikeText(snap);

  const bodyObj = snap.body;
  const bodyTextCandidate =
    typeof bodyObj === 'string'
      ? bodyObj
      : bodyObj && typeof bodyObj === 'object'
        ? str((bodyObj as Record<string, unknown>).text) ||
          (Array.isArray((bodyObj as Record<string, unknown>).texts)
            ? (bodyObj as Record<string, unknown>).texts
                .filter((t): t is string => typeof t === 'string')
                .join(' ')
            : '')
        : '';
  const { hadTemplate: bodyHadTemplate } = stripTemplatePlaceholders(String(bodyTextCandidate ?? ''));

  const strippedPrimary = primaryPieces
    .map((p) => stripTemplatePlaceholders(p).text)
    .filter(Boolean)
    .join('\n\n')
    .trim();

  if (strippedPrimary.length >= 20) {
    return { text: strippedPrimary, fallbackUsed: 'body', templateDetected: bodyHadTemplate };
  }

  const altCandidates: Array<{
    key:
      | 'title'
      | 'link_description'
      | 'caption'
      | 'card_title'
      | 'card_description'
      | 'card_caption';
    value: string;
  }> = [];

  const title = str(snap.title).trim();
  if (title) altCandidates.push({ key: 'title', value: title });
  const desc = str(snap.link_description).trim();
  if (desc) altCandidates.push({ key: 'link_description', value: desc });
  const caption = str(snap.caption).trim();
  if (caption) altCandidates.push({ key: 'caption', value: caption });

  const cards = snap.cards;
  if (Array.isArray(cards)) {
    const first = cards.find((c) => c && typeof c === 'object') as Record<string, unknown> | undefined;
    if (first) {
      const ct = str(first.title).trim();
      if (ct) altCandidates.push({ key: 'card_title', value: ct });
      const cd = str(first.link_description).trim();
      if (cd) altCandidates.push({ key: 'card_description', value: cd });
      const cc = str(first.caption).trim();
      if (cc) altCandidates.push({ key: 'card_caption', value: cc });
    }
  }

  for (const alt of altCandidates) {
    const { text } = stripTemplatePlaceholders(alt.value);
    if (text.length >= 20) {
      return { text, fallbackUsed: alt.key, templateDetected: bodyHadTemplate };
    }
  }

  if (strippedPrimary.length > 0) {
    return { text: strippedPrimary, fallbackUsed: 'body', templateDetected: bodyHadTemplate };
  }

  return { text: '', fallbackUsed: 'none', templateDetected: bodyHadTemplate };
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

  const pageName = str(row.page_name) || str(snap.page_name);
  const pageId = str(row.page_id) || str(snap.page_id);
  const extracted = extractBestAdText(snap);
  const adTextRaw = extracted.text;

  const adArchive = row.ad_archive_id ?? row.ad_id;
  const adId =
    adArchive !== undefined && adArchive !== null && String(adArchive).trim() !== ''
      ? String(adArchive)
      : '';

  const linkUrl = pickBestLandingPageUrl(snap);
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
  const pageProfileUri = str(snap.page_profile_uri).trim();

  if (extracted.templateDetected && extracted.fallbackUsed !== 'body') {
    logger.debug(
      { pageId, fallbackUsed: extracted.fallbackUsed },
      'adText primary had template placeholder, used fallback',
    );
  }

  const rawLinkUrl = str(snap.link_url).trim();
  if (linkUrl && rawLinkUrl && rawLinkUrl !== linkUrl) {
    logger.debug({ pageId, source: 'fallback' }, 'landingPageUrl used snapshot fallback');
  }

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
    facebookPageUrl: pageProfileUri || undefined,
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
