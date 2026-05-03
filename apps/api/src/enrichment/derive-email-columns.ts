import { prisma } from '@hyperscale/database';
import type { LeadEmail } from '@hyperscale/database';

/**
 * Maps Stage 5 pattern names (from sourceDetail) to the corresponding column.
 * The pattern names come from generatePatternGuesses() in stage-5-pattern-guesses.ts.
 */
const PATTERN_TO_COLUMN: Record<string, string> = {
  firstname: 'emailGuessFirstname',
  'firstname.lastname': 'emailGuessFirstnameDotLast',
  firstnamelastname: 'emailGuessFirstnameLast',
  firstinitiallastname: 'emailGuessFirstinitialLast',
  admin: 'emailGuessAdmin',
  info: 'emailGuessInfo',
  hello: 'emailGuessHello',
  contact: 'emailGuessContact',
};

/**
 * Computes the per-source numbered columns and pattern-guess columns from
 * a lead's LeadEmail rows. Returns the data ready to be passed to
 * prisma.knownAdvertiser.update().
 *
 * Caps:
 * - emailFromBio: 1 (any extras beyond first are dropped)
 * - emailFromIg: up to 2 (Stage 6 Apify)
 * - emailFromSite: up to 3
 * - emailFromSerp: up to 3
 * - emailFromSnov: up to 5
 * Pattern guesses: 1:1 mapping per pattern.
 */
export function buildEmailColumnUpdate(leadEmails: LeadEmail[]): Record<string, string | null> {
  const update: Record<string, string | null> = {
    emailFromBio: null,
    emailFromIg1: null,
    emailFromIg2: null,
    emailFromSite1: null,
    emailFromSite2: null,
    emailFromSite3: null,
    emailFromSerp1: null,
    emailFromSerp2: null,
    emailFromSerp3: null,
    emailFromSnov1: null,
    emailFromSnov2: null,
    emailFromSnov3: null,
    emailFromSnov4: null,
    emailFromSnov5: null,
    emailGuessFirstname: null,
    emailGuessFirstnameDotLast: null,
    emailGuessFirstnameLast: null,
    emailGuessFirstinitialLast: null,
    emailGuessAdmin: null,
    emailGuessInfo: null,
    emailGuessHello: null,
    emailGuessContact: null,
  };

  const bioEmails = leadEmails.filter((e) => e.source === 'BIO_TEXT');
  const siteEmails = leadEmails.filter((e) => e.source === 'SITE_SCRAPE');
  const serpEmails = leadEmails.filter((e) => e.source === 'GOOGLE_SERP');
  const snovEmails = leadEmails.filter((e) => e.source === 'SNOV');
  const guessEmails = leadEmails.filter((e) => e.source === 'GUESS');
  const igEmails = leadEmails.filter((e) => e.source === 'APIFY_IG_SCRAPER');

  // Bio: take first only (Stage 0 typically returns 1).
  if (bioEmails[0]) update.emailFromBio = bioEmails[0].address;

  // Stage 6 Apify IG: up to 2.
  if (igEmails[0]) update.emailFromIg1 = igEmails[0].address;
  if (igEmails[1]) update.emailFromIg2 = igEmails[1].address;

  // Site: up to 3.
  if (siteEmails[0]) update.emailFromSite1 = siteEmails[0].address;
  if (siteEmails[1]) update.emailFromSite2 = siteEmails[1].address;
  if (siteEmails[2]) update.emailFromSite3 = siteEmails[2].address;

  // Serp: up to 3.
  if (serpEmails[0]) update.emailFromSerp1 = serpEmails[0].address;
  if (serpEmails[1]) update.emailFromSerp2 = serpEmails[1].address;
  if (serpEmails[2]) update.emailFromSerp3 = serpEmails[2].address;

  // Snov: up to 5.
  if (snovEmails[0]) update.emailFromSnov1 = snovEmails[0].address;
  if (snovEmails[1]) update.emailFromSnov2 = snovEmails[1].address;
  if (snovEmails[2]) update.emailFromSnov3 = snovEmails[2].address;
  if (snovEmails[3]) update.emailFromSnov4 = snovEmails[3].address;
  if (snovEmails[4]) update.emailFromSnov5 = snovEmails[4].address;

  // Pattern guesses: 1:1 mapping by sourceDetail.
  for (const guess of guessEmails) {
    if (!guess.sourceDetail) continue;
    const column = PATTERN_TO_COLUMN[guess.sourceDetail];
    if (column) {
      update[column] = guess.address;
    }
  }

  return update;
}

/**
 * Picks the primary email from the per-source columns based on priority:
 * bio > ig1 > ig2 > site1 > snov1 > site2 > snov2 > site3 > snov3 > snov4 > snov5
 *  > serp1 > serp2 > serp3.
 *
 * Skips role-type emails (admin/info/hello/contact) unless nothing else exists.
 * Returns null if no found-emails exist.
 *
 * Guesses are explicitly excluded — those are unverified candidates.
 */
export function pickEmailPrimary(columns: Record<string, string | null>): string | null {
  const ROLE_LOCAL_PARTS = new Set(['admin', 'info', 'hello', 'contact', 'support', 'help', 'sales']);

  function isRoleEmail(email: string | null): boolean {
    if (!email) return false;
    const localPart = email.split('@')[0]?.toLowerCase() ?? '';
    return ROLE_LOCAL_PARTS.has(localPart);
  }

  const priorityOrder = [
    'emailFromBio',
    'emailFromIg1',
    'emailFromIg2',
    'emailFromSite1',
    'emailFromSnov1',
    'emailFromSite2',
    'emailFromSnov2',
    'emailFromSite3',
    'emailFromSnov3',
    'emailFromSnov4',
    'emailFromSnov5',
    'emailFromSerp1',
    'emailFromSerp2',
    'emailFromSerp3',
  ] as const;

  // First pass: find first non-role email.
  for (const col of priorityOrder) {
    const email = columns[col];
    if (email && !isRoleEmail(email)) {
      return email;
    }
  }

  // Second pass: fall back to first non-null email (including roles).
  for (const col of priorityOrder) {
    const email = columns[col];
    if (email) return email;
  }

  return null;
}

/**
 * Reads all LeadEmail rows for a lead, computes the new column values,
 * picks the primary, and updates the KnownAdvertiser row.
 */
export async function syncEmailColumnsForLead(leadId: string): Promise<void> {
  const leadEmails = await prisma.leadEmail.findMany({
    where: { leadId },
    orderBy: { createdAt: 'asc' },
  });

  const columnUpdate = buildEmailColumnUpdate(leadEmails);
  const emailPrimary = pickEmailPrimary(columnUpdate);

  await prisma.knownAdvertiser.update({
    where: { id: leadId },
    data: {
      ...columnUpdate,
      emailPrimary,
    },
  });
}
