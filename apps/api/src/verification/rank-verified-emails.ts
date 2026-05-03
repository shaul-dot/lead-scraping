import type { LeadEmail } from '@hyperscale/database';

const SOURCE_PRIORITY: Record<string, number> = {
  BIO_TEXT: 1,
  SITE_SCRAPE: 2,
  SNOV: 3,
  APIFY_IG_SCRAPER: 4,
  GOOGLE_SERP: 5,
  LINKTREE_RESOLVE: 6,
  GUESS: 7,
};

const TYPE_PRIORITY: Record<string, number> = {
  PERSONAL: 1,
  GENERIC: 2,
  ROLE: 3,
  UNKNOWN: 4,
};

/**
 * Rank verified LeadEmail rows by likelihood of belonging to the actual person.
 * Returns top 3 in order. Excludes any non-VALID emails.
 */
export function rankVerifiedEmails(leadEmails: LeadEmail[]): {
  primary: string | null;
  secondary: string | null;
  tertiary: string | null;
  verifiedCount: number;
} {
  const valid = leadEmails.filter((e) => e.verificationStatus === 'VALID');

  const sorted = [...valid].sort((a, b) => {
    const typeA = TYPE_PRIORITY[a.emailType] ?? 99;
    const typeB = TYPE_PRIORITY[b.emailType] ?? 99;
    if (typeA !== typeB) return typeA - typeB;

    const sourceA = SOURCE_PRIORITY[a.source] ?? 99;
    const sourceB = SOURCE_PRIORITY[b.source] ?? 99;
    if (sourceA !== sourceB) return sourceA - sourceB;

    return a.address.localeCompare(b.address);
  });

  return {
    primary: sorted[0]?.address ?? null,
    secondary: sorted[1]?.address ?? null,
    tertiary: sorted[2]?.address ?? null,
    verifiedCount: valid.length,
  };
}
