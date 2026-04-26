import { normalizeInstagramHandle } from './normalize-platform-handles';

/**
 * Aggregator-specific reserved paths that aren't user handles.
 * These are marketing/admin/blog paths the aggregator uses for its own pages.
 * If we see one of these as the first path segment, skip extraction.
 */
const AGGREGATOR_RESERVED_PATHS = new Set([
  // Common marketing/admin
  'about',
  'blog',
  'help',
  'login',
  'signup',
  'sign-up',
  'register',
  'admin',
  'api',
  'app',
  'pricing',
  'features',
  'home',
  'support',
  'contact',
  'terms',
  'privacy',
  'tos',
  'legal',
  'docs',
  // Linktree-specific
  'linktree',
  's',
  // Beacons-specific
  'i',
  'templates',
  'creators',
  // Stan-specific
  'affiliates',
  'creator',
  'partners',
  // Generic
  'p',
  'product',
  'products',
  'page',
  'pages',
]);

/**
 * Aggregator hostnames we accept. Subdomains like coach.stan.store,
 * stanley.stan.store, etc. should be rejected.
 */
const ACCEPTED_AGGREGATOR_HOSTS = new Set([
  'linktr.ee',
  'www.linktr.ee',
  'beacons.ai',
  'www.beacons.ai',
  'stan.store',
  'www.stan.store',
  'bento.me',
  'www.bento.me',
]);

/**
 * Extract Instagram handle from text content (SERP title or description).
 * Looks for @handle patterns and validates them.
 */
export function extractInstagramHandleFromText(text: string | null | undefined): string | null {
  if (!text) return null;

  // Avoid email addresses and "user@domain.com" by enforcing non-word boundary on both sides.
  const matches = text.match(/(?<![\w.])@([a-zA-Z0-9._]{1,30})(?![\w.])/g);
  if (!matches || matches.length === 0) return null;

  for (const match of matches) {
    const raw = match.startsWith('@') ? match.slice(1) : match;
    // Heuristic: reject email-like domains (e.g. "@example.com") while still allowing dotted IG handles.
    // If it ends with ".<letters>" and has no digits anywhere, treat it as likely email/domain.
    if (/\.[a-z]{2,10}$/i.test(raw) && !/\d/.test(raw)) continue;
    const handle = normalizeInstagramHandle(match);
    if (handle) return handle;
  }

  return null;
}

/**
 * Extract Instagram handle from an aggregator page URL.
 * - Only accepts known aggregator hostnames (no subdomains like coach.stan.store)
 * - Filters out aggregator-reserved paths (e.g., /blog, /i, /about)
 * - Reuses normalizeInstagramHandle for character validation
 */
export function extractHandleFromAggregatorUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase();
    if (!ACCEPTED_AGGREGATOR_HOSTS.has(host)) return null;

    const pathSegments = u.pathname.split('/').filter(Boolean);
    if (pathSegments.length === 0) return null;

    const candidate = pathSegments[0]!.toLowerCase();
    if (AGGREGATOR_RESERVED_PATHS.has(candidate)) return null;

    return normalizeInstagramHandle(candidate);
  } catch {
    return null;
  }
}

/**
 * Try multiple sources to extract an IG handle from a SERP result for an aggregator URL.
 * Tries (in order): description text, title text, URL path. Returns first valid match.
 */
export function extractIgHandleFromAggregatorResult(opts: {
  url: string | null;
  title: string | null;
  description: string | null;
}): string | null {
  return (
    extractInstagramHandleFromText(opts.description) ??
    extractInstagramHandleFromText(opts.title) ??
    extractHandleFromAggregatorUrl(opts.url)
  );
}

