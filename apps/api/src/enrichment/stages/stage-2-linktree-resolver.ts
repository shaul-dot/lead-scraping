import { normalizeDomain } from '@hyperscale/adapters/utils/normalize-domain';
import { isPlatformDomain } from '@hyperscale/adapters/utils/platform-domains';

// Domains that have linktree-style pages we can fetch directly via HTTP.
// Beacons.ai and bio.link return 403 from Cloudflare on direct fetch, so they're
// excluded — Stage 2 returns applicable: true / fetchSucceeded: false for them
// is misleading; better to mark them not applicable for this stage.
const SUPPORTED_LINKTREE_DOMAINS = new Set<string>(['linktr.ee']);

// Domains that are NEVER the coach's real website even if they appear in a linktree.
const NEVER_PROMOTE_DOMAINS = [
  'instagram.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'linkedin.com',
  'pinterest.com',
  'snapchat.com',
  'threads.net',
  'whatsapp.com',
  'wa.me',
  't.me',
  'telegram.org',
  'zoom.us',
  'calendly.com',
  'cal.com',
  'medium.com',
  'substack.com',
  'wordpress.com',
  'blogspot.com',
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  // Course / community / commerce hosts often used as linktree destinations
  'teachable.com',
  'thinkific.com',
  'kajabi.com',
  'podia.com',
  'gumroad.com',
  'patreon.com',
  'skool.com',
  'circle.so',
  'mighty.app',
  'mightynetworks.com',
  'shopify.com',
  'etsy.com',
  // Email / newsletter platforms
  'mailchimp.com',
  'convertkit.com',
  'flodesk.com',
  'beehiiv.com',
  // App store / download links
  'apps.apple.com',
  'play.google.com',
  'spotify.com',
  'apple.com',
  // Affiliate / link-shortener services
  'bit.ly',
  't.co',
  'tinyurl.com',
  'amzn.to',
  'amazon.com',
  // Linktree's own infrastructure
  'production.linktr.ee',
  'assets.production.linktr.ee',
  // Third-party assets often linked before real outbound URLs in HTML order
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// Browser-like User-Agent to avoid being served degraded responses.
const FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Fetch timeout — linktree pages are simple, should respond quickly.
const FETCH_TIMEOUT_MS = 10_000;

// Regex to extract href= URLs from raw HTML. Captures attribute value (single OR double quoted).
const HREF_REGEX = /href=["']([^"']+)["']/gi;

export type Stage2Result = {
  /** True if Stage 2 was applicable (lead had a supported linktree-style URL). */
  applicable: boolean;
  /** True if the linktree page was successfully fetched. */
  fetchSucceeded: boolean;
  /** The real domain we resolved to, if found. */
  resolvedDomain: string | null;
  /** The full URL of the resolved domain. */
  resolvedUrl: string | null;
  /** Total candidate URLs we found in the page (after filtering linktree-internal assets). */
  candidatesFound: number;
  /** Error message if fetch failed; null otherwise. */
  error: string | null;
};

/**
 * Decide whether a domain is a viable "real personal website" candidate.
 */
function isViableCandidate(domain: string): boolean {
  if (!domain) return false;
  if (isPlatformDomain(domain)) return false; // linktr.ee, beacons.ai, etc.
  if (NEVER_PROMOTE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return false;
  return true;
}

/**
 * Fetch URL with timeout. Returns null on any failure.
 */
async function fetchWithTimeout(url: string): Promise<{ html: string; status: number } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': FETCH_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      // No redirects to anti-bot pages, but follow standard 301/302.
      redirect: 'follow',
    });

    if (!response.ok) {
      return { error: `http_${response.status}` };
    }

    const html = await response.text();
    return { html, status: response.status };
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') return { error: 'timeout' };
      return { error: err.message };
    }
    return { error: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run Stage 2: direct HTTP fetch of a linktr.ee page, parse hrefs, find the
 * coach's real domain. Returns null resolvedDomain if no good candidate found.
 */
export async function resolveLinktree(linktreeUrl: string | null): Promise<Stage2Result> {
  const result: Stage2Result = {
    applicable: false,
    fetchSucceeded: false,
    resolvedDomain: null,
    resolvedUrl: null,
    candidatesFound: 0,
    error: null,
  };

  if (!linktreeUrl || linktreeUrl.trim().length === 0) {
    return result;
  }

  const linktreeDomain = normalizeDomain(linktreeUrl);
  if (!linktreeDomain || !SUPPORTED_LINKTREE_DOMAINS.has(linktreeDomain)) {
    // Not a supported linktree-style URL — Stage 2 doesn't apply.
    // (beacons.ai, bio.link, etc. are intentionally excluded — they 403 on direct fetch.)
    return result;
  }

  result.applicable = true;

  // Normalize URL — prefer https.
  const url = linktreeUrl.startsWith('http://')
    ? linktreeUrl.replace(/^http:\/\//, 'https://')
    : linktreeUrl.startsWith('https://')
      ? linktreeUrl
      : `https://${linktreeUrl}`;

  const fetchResult = await fetchWithTimeout(url);
  if ('error' in fetchResult) {
    result.error = fetchResult.error;
    return result;
  }

  result.fetchSucceeded = true;

  // Extract all href= values from the HTML.
  HREF_REGEX.lastIndex = 0;
  const matches: string[] = [];
  let match;
  while ((match = HREF_REGEX.exec(fetchResult.html)) !== null) {
    matches.push(match[1]);
  }

  const seenDomain = new Set<string>();
  const candidates: { url: string; domain: string }[] = [];

  for (const rawHref of matches) {
    // Skip relative URLs, anchors, mailto, tel, etc.
    if (!rawHref.startsWith('http://') && !rawHref.startsWith('https://')) continue;

    const domain = normalizeDomain(rawHref);
    if (!domain) continue;

    // Dedupe by domain — only need each domain once.
    if (seenDomain.has(domain)) continue;
    seenDomain.add(domain);

    candidates.push({ url: rawHref, domain });
  }

  result.candidatesFound = candidates.length;

  // Pick the first viable candidate.
  const viable = candidates.find((c) => isViableCandidate(c.domain));

  if (viable) {
    result.resolvedDomain = viable.domain;
    result.resolvedUrl = viable.url;
  }

  return result;
}
