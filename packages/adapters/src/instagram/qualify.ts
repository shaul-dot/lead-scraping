import { icpConfig } from '@hyperscale/config';
import pino from 'pino';

const logger = pino({ name: 'ig-qualify' });

export interface RawInstagramProfile {
  username: string;
  fullName: string;
  bio: string;
  bioLinkUrl?: string;
  followerCount: number;
  profileUrl: string;
  country?: string;
}

export interface IGQualificationResult {
  qualified: boolean;
  reason?: string;
  landingPageUrl?: string;
}

const COACHING_KEYWORDS = [
  'coach', 'coaching', 'mentor', 'mentoring', 'trainer', 'training',
  'consultant', 'consulting', 'course', 'program', 'masterclass',
  'strategist', 'advisor', 'agency', 'expert', 'specialist',
];

const TRAINING_KEYWORDS = [
  'webinar', 'masterclass', 'training', 'challenge', 'workshop',
  'free', 'register', 'sign up', 'signup', 'enroll', 'join',
  'bootcamp', 'free class', 'live training', 'free course',
  'video series', 'summit',
];

const LINKTREE_HOSTS = ['linktr.ee', 'linktree.com', 'lnk.bio', 'bio.link', 'beacons.ai'];

const SHOP_ONLY_INDICATORS = [
  'shopify.com', 'etsy.com', 'amazon.com', 'gumroad.com',
  '/shop', '/store', '/products', '/collections',
];

const MIN_FOLLOWER_COUNT = 1000;

export function qualifyProfile(profile: RawInstagramProfile): IGQualificationResult {
  const bio = profile.bio.toLowerCase();

  const hasCoachingKeyword = COACHING_KEYWORDS.some((kw) => bio.includes(kw));
  if (!hasCoachingKeyword) {
    return { qualified: false, reason: 'Bio lacks coaching/consulting keywords' };
  }

  if (!looksEnglish(profile.bio)) {
    return { qualified: false, reason: 'Bio does not appear to be in English' };
  }

  if (!profile.bioLinkUrl) {
    return { qualified: false, reason: 'No link in bio' };
  }

  if (profile.followerCount < MIN_FOLLOWER_COUNT) {
    return { qualified: false, reason: `Follower count ${profile.followerCount} below minimum ${MIN_FOLLOWER_COUNT}` };
  }

  if (profile.country && !icpConfig.hardFilters.isApprovedCountry(profile.country)) {
    return { qualified: false, reason: `Country '${profile.country}' not in approved list` };
  }

  const isBlocklisted = icpConfig.blocklist.phrases.some((phrase) =>
    bio.includes(phrase),
  );
  if (isBlocklisted) {
    return { qualified: false, reason: 'Bio contains blocklisted phrase' };
  }

  try {
    const domain = new URL(profile.bioLinkUrl).hostname.toLowerCase();
    const domainBlocked = icpConfig.blocklist.domains.some(
      (d) => domain === d || domain.endsWith(`.${d}`),
    );
    if (domainBlocked) {
      return { qualified: false, reason: `Domain '${domain}' is blocklisted` };
    }
  } catch {
    return { qualified: false, reason: 'Invalid bio link URL' };
  }

  return { qualified: true, landingPageUrl: profile.bioLinkUrl };
}

/**
 * Validate a bio link by fetching the page and checking for training-related content.
 * For linktree pages, scans all links.
 */
export async function validateBioLink(
  url: string,
): Promise<{ isTrainingPage: boolean; resolvedUrl?: string }> {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    const isLinktree = LINKTREE_HOSTS.some(
      (h) => hostname === h || hostname.endsWith(`.${h}`),
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn({ url, status: response.status }, 'Bio link fetch failed');
      return { isTrainingPage: false };
    }

    const html = await response.text();
    const text = stripHtml(html).toLowerCase();

    if (isLinktree) {
      return scanLinktreeForTraining(html, text, url);
    }

    if (isShopOnlyPage(text, url)) {
      return { isTrainingPage: false };
    }

    const hasTrainingKeyword = TRAINING_KEYWORDS.some((kw) => text.includes(kw));
    return {
      isTrainingPage: hasTrainingKeyword,
      resolvedUrl: hasTrainingKeyword ? response.url : undefined,
    };
  } catch (err) {
    logger.warn({ url, err }, 'Bio link validation error');
    return { isTrainingPage: false };
  }
}

function scanLinktreeForTraining(
  html: string,
  text: string,
  baseUrl: string,
): { isTrainingPage: boolean; resolvedUrl?: string } {
  const linkMatches = html.match(/href=["']([^"']+)["']/gi) ?? [];
  const links: string[] = [];

  for (const match of linkMatches) {
    const hrefMatch = match.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    try {
      const resolved = new URL(hrefMatch[1], baseUrl).href;
      if (!LINKTREE_HOSTS.some((h) => resolved.includes(h))) {
        links.push(resolved);
      }
    } catch {
      // skip invalid urls
    }
  }

  const anchorTexts = html.match(/>([^<]+)</g)?.map((m) => m.slice(1, -1).toLowerCase()) ?? [];
  const combinedText = [...anchorTexts, text].join(' ');

  const hasTraining = TRAINING_KEYWORDS.some((kw) => combinedText.includes(kw));
  if (hasTraining) {
    const trainingLink = links.find((link) => {
      const lower = link.toLowerCase();
      return TRAINING_KEYWORDS.some((kw) => lower.includes(kw));
    });
    return { isTrainingPage: true, resolvedUrl: trainingLink ?? links[0] };
  }

  return { isTrainingPage: false };
}

function isShopOnlyPage(text: string, url: string): boolean {
  const combined = `${text} ${url}`.toLowerCase();
  const shopSignals = SHOP_ONLY_INDICATORS.filter((ind) => combined.includes(ind));
  const trainingSignals = TRAINING_KEYWORDS.filter((kw) => combined.includes(kw));
  return shopSignals.length > 0 && trainingSignals.length === 0;
}

function looksEnglish(text: string): boolean {
  if (!text || text.length < 10) return true;

  const asciiChars = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (asciiChars.length === 0) return true;

  const latinChars = asciiChars.replace(/[^\x00-\x7F]/g, '');
  const ratio = latinChars.length / asciiChars.length;
  return ratio >= 0.7;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractCompanyName(fullName: string, bio: string): string {
  const bioLines = bio.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of bioLines) {
    const lower = line.toLowerCase();
    if (
      (lower.includes('founder') || lower.includes('ceo') || lower.includes('owner')) &&
      lower.includes(' of ') || lower.includes(' at ')
    ) {
      const ofMatch = line.match(/(?:of|at)\s+(.+)/i);
      if (ofMatch) {
        const name = ofMatch[1].replace(/[|•🔥✨💫🚀⭐️🎯📈💪🏆👇⬇️🔗]/g, '').trim();
        if (name.length > 2 && name.length < 60) return name;
      }
    }
  }

  return fullName;
}
