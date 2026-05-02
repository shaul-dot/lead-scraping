import type Anthropic from '@anthropic-ai/sdk';
import {
  BrightDataClient,
  validateDomainCandidate,
  type DomainCandidate,
} from '@hyperscale/adapters';
import { normalizeDomain } from '@hyperscale/adapters/utils/normalize-domain';
import { isPlatformDomain } from '@hyperscale/adapters/utils/platform-domains';

// Reuse the same NEVER_PROMOTE list pattern as Stage 0 / Stage 2 for consistency.
const NEVER_PROMOTE_DOMAINS = new Set([
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
  'teachable.com',
  'thinkific.com',
  'kajabi.com',
  'podia.com',
  'gumroad.com',
  'patreon.com',
  'skool.com',
  'circle.so',
  'shopify.com',
  'amazon.com',
  'apple.com',
  'spotify.com',
  // Search engines and aggregators that might show up in results
  'google.com',
  'bing.com',
  'duckduckgo.com',
  'wikipedia.org',
  'reddit.com',
  'quora.com',
  // Directory / listing sites
  'yelp.com',
  'glassdoor.com',
  'crunchbase.com',
  'zoominfo.com',
]);

export type Stage3aResult = {
  /** True if Stage 3a was applicable (lead had name + niche, no domain). */
  applicable: boolean;
  /** True if SERP fetch succeeded. */
  serpSucceeded: boolean;
  /** True if Claude validated a candidate. */
  validationSucceeded: boolean;
  /** Number of candidate URLs we passed to Claude after filtering. */
  candidatesValidated: number;
  /** The resolved domain, if Claude confirmed a match. */
  resolvedDomain: string | null;
  /** The full URL of the resolved domain. */
  resolvedUrl: string | null;
  /** Claude's reasoning for the selection (or rejection). */
  reasoning: string | null;
  /** Error if anything failed catastrophically. */
  error: string | null;
};

/**
 * Filter SERP organic results to URLs we'd consider promoting.
 * Strips social media, directories, search engines, etc.
 */
function filterCandidates(
  organic: Array<{ rank: number; link: string; title: string; description: string }>,
  maxCandidates: number,
): DomainCandidate[] {
  const seen = new Set<string>();
  const filtered: DomainCandidate[] = [];

  for (const result of organic) {
    if (filtered.length >= maxCandidates) break;

    const domain = normalizeDomain(result.link);
    if (!domain) continue;

    // Dedupe by domain
    if (seen.has(domain)) continue;
    seen.add(domain);

    // Skip platform domains (linktr.ee etc.) and never-promote list
    if (isPlatformDomain(domain)) continue;
    if (NEVER_PROMOTE_DOMAINS.has(domain)) continue;
    if ([...NEVER_PROMOTE_DOMAINS].some((d) => domain.endsWith(`.${d}`))) continue;

    filtered.push({
      url: result.link,
      title: result.title,
      description: result.description,
    });
  }

  return filtered;
}

/**
 * Run Stage 3a: SERP query for the lead, validate top candidates with Claude,
 * return the resolved domain (or null if no confident match).
 */
export async function discoverDomain(
  brightData: BrightDataClient,
  anthropic: Anthropic,
  personName: string,
  niche: string,
): Promise<Stage3aResult> {
  const result: Stage3aResult = {
    applicable: false,
    serpSucceeded: false,
    validationSucceeded: false,
    candidatesValidated: 0,
    resolvedDomain: null,
    resolvedUrl: null,
    reasoning: null,
    error: null,
  };

  if (!personName?.trim() || !niche?.trim()) {
    return result; // applicable: false
  }

  result.applicable = true;

  const query = `"${personName.trim()}" ${niche.trim()}`;

  const serpResult = await brightData.runGoogleSerp(query);

  if (!serpResult.success) {
    result.error = serpResult.reason;
    return result;
  }

  result.serpSucceeded = true;

  const candidates = filterCandidates(serpResult.organic, 3);

  if (candidates.length === 0) {
    result.reasoning = 'No viable candidates after filtering';
    return result;
  }

  result.candidatesValidated = candidates.length;

  const validation = await validateDomainCandidate(anthropic, {
    personName,
    niche,
    candidates,
  });

  result.reasoning = validation.reasoning;

  if (!validation.selectedUrl) {
    return result;
  }

  result.validationSucceeded = true;
  result.resolvedUrl = validation.selectedUrl;
  result.resolvedDomain = normalizeDomain(validation.selectedUrl);

  return result;
}
