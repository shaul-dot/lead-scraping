import { normalizeDomain } from '@hyperscale/adapters/utils/normalize-domain';
import { isPlatformDomain } from '@hyperscale/adapters/utils/platform-domains';

// Email regex: standard form, conservative.
const EMAIL_REGEX = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

// URL regex: matches http(s)://... and bare domain patterns like "coachname.com" or "coachname.com/something".
// Anchored on word boundary to reduce false positives inside other text.
const URL_REGEX = /\b(?:https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?)/gi;

// Domains we should never promote to websiteDomain (social platforms, generic services, etc.)
// These are in addition to whatever isPlatformDomain() catches (link-in-bio platforms).
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
  'medium.com',
  'substack.com',
  'wordpress.com',
  'blogspot.com',
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
];

export type Stage0Result = {
  emails: string[];
  promotedDomain: string | null;
  promotedUrl: string | null;
};

/**
 * Run Stage 0 (bio mining) on a piece of free-text content.
 * Returns email candidates found and (optionally) a domain to promote
 * if the lead currently has no websiteDomain.
 */
export function mineBioText(bioText: string | null, leadHasWebsiteDomain: boolean): Stage0Result {
  const result: Stage0Result = { emails: [], promotedDomain: null, promotedUrl: null };

  if (!bioText || bioText.trim().length === 0) {
    return result;
  }

  // Extract emails. Lowercase + dedupe.
  const rawEmails = bioText.match(EMAIL_REGEX) || [];
  const seen = new Set<string>();
  for (const e of rawEmails) {
    const lower = e.toLowerCase().trim();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.emails.push(lower);
    }
  }

  // If lead already has a domain, no URL promotion needed.
  if (leadHasWebsiteDomain) {
    return result;
  }

  // Extract URLs and try to promote a real personal domain.
  const rawUrls = bioText.match(URL_REGEX) || [];
  for (const rawUrl of rawUrls) {
    // Skip URLs that are actually email addresses (regex above can match the @domain part).
    if (rawUrl.includes('@')) continue;

    const domain = normalizeDomain(rawUrl);
    if (!domain) continue;

    // Filter: skip link-in-bio platforms, social media, generic services.
    if (isPlatformDomain(domain)) continue;
    if (NEVER_PROMOTE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) continue;

    // First valid candidate wins.
    result.promotedDomain = domain;
    result.promotedUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    break;
  }

  return result;
}
