import { icpConfig } from '@hyperscale/config';

export interface RawFacebookAd {
  pageId: string;
  pageName: string;
  adCreativeId: string;
  adText: string;
  adCreativeBodies: string[];
  adCreativeLinkTitles: string[];
  adCreativeLinkDescriptions: string[];
  landingPageUrl: string;
  adSnapshotUrl: string;
  adDeliveryStopTime: string | null;
  country: string;
  startDate: string;
}

export interface QualificationResult {
  qualified: boolean;
  reason?: string;
}

const NICHE_KEYWORDS = [
  'coaching',
  'coach',
  'consulting',
  'consultant',
  'education',
  'e-learning',
  'elearning',
  'online course',
  'course creator',
  'training',
  'mentor',
  'mentoring',
  'tutoring',
  'academy',
  'institute',
  'school of',
  'personal development',
  'business growth',
  'mindset',
  'transformation',
  'mastermind',
];

const LEAD_MAGNET_KEYWORDS = [
  'free training',
  'webinar',
  'masterclass',
  'challenge',
  'workshop',
  'bootcamp',
  'free class',
  'live training',
  'free course',
  'video series',
  'summit',
  'register now',
  'sign up free',
  'join free',
  'free masterclass',
  'free webinar',
  'free workshop',
  'free challenge',
  'save your spot',
  'reserve your seat',
];

/**
 * Qualifies a Facebook ad against the SOP criteria.
 * An ad qualifies when ALL of these are true:
 *  1. Country filter — approved countries when `country` is present
 *  2. Niche match — `pageName` + `adText` against NICHE_KEYWORDS
 *  3. English heuristic — creative bodies
 *  4. Lead magnet keywords — bodies + link titles/descriptions
 *  5. Blocklist — phrases and landing-page domains
 */
export function qualifyAd(ad: RawFacebookAd): QualificationResult {
  // Check 1: Country filter
  if (ad.country && !icpConfig.hardFilters.isApprovedCountry(ad.country)) {
    return {
      qualified: false,
      reason: `Country '${ad.country}' not in approved list`,
    };
  }

  const allText = ad.adText.toLowerCase();
  const pageNameLower = ad.pageName.toLowerCase();
  const combinedTextForNiche = `${pageNameLower} ${allText}`;

  // Check 2: Niche match (pageName + adText vs NICHE_KEYWORDS)
  const matchesNiche = NICHE_KEYWORDS.some((kw) =>
    combinedTextForNiche.includes(kw),
  );
  if (!matchesNiche) {
    return {
      qualified: false,
      reason: 'Advertiser does not match coaching/consulting/education niche',
    };
  }

  // Check 3: English heuristic (creative bodies)
  if (!isLikelyEnglish(ad.adCreativeBodies)) {
    return { qualified: false, reason: 'Ad does not appear to be in English' };
  }

  // Check 4: Lead magnet keywords (bodies + link titles/descriptions)
  const textForLeadMagnet = `${allText} ${(ad.adCreativeLinkTitles ?? []).join(' ')} ${(ad.adCreativeLinkDescriptions ?? []).join(' ')}`.toLowerCase();
  const hasLeadMagnet = LEAD_MAGNET_KEYWORDS.some((kw) =>
    textForLeadMagnet.includes(kw),
  );
  if (!hasLeadMagnet) {
    return {
      qualified: false,
      reason: 'No lead magnet keywords detected (webinar, masterclass, etc.)',
    };
  }

  // Check 5: Blocklist — phrases
  const isBlocklisted = icpConfig.blocklist.phrases.some((phrase) =>
    allText.includes(phrase),
  );
  if (isBlocklisted) {
    return { qualified: false, reason: 'Ad text contains blocklisted phrase' };
  }

  // Check 5: Blocklist — landing domains
  if (ad.landingPageUrl) {
    try {
      const domain = new URL(ad.landingPageUrl).hostname.toLowerCase();
      const domainBlocked = icpConfig.blocklist.domains.some(
        (d) => domain === d || domain.endsWith(`.${d}`),
      );
      if (domainBlocked) {
        return { qualified: false, reason: `Domain '${domain}' is blocklisted` };
      }
    } catch {
      // Invalid URL is not a disqualifier by itself if snapshot URL exists
    }
  }

  return { qualified: true };
}

/**
 * Heuristic English detection: checks if the ad body text contains
 * enough common English stop-words/articles. If no body text is
 * present, we assume English (Meta API defaults).
 */
function isLikelyEnglish(bodies: string[]): boolean {
  if (!bodies || bodies.length === 0) return true;

  const text = bodies.join(' ').toLowerCase();
  if (text.length < 10) return true;

  const englishMarkers = [
    'the',
    'and',
    'you',
    'your',
    'this',
    'that',
    'with',
    'for',
    'are',
    'from',
    'have',
    'will',
    'how',
    'what',
    'can',
    'our',
    'get',
    'learn',
    'free',
    'join',
  ];

  const words = text.split(/\s+/);
  const markerCount = words.filter((w) => englishMarkers.includes(w)).length;
  const ratio = markerCount / words.length;

  // If at least 5% of words are common English words, treat as English
  return ratio >= 0.05;
}
