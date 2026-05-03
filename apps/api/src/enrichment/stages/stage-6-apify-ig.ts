import { ApifyClient } from 'apify-client';

const ACTOR_ID = 'logical_scrapers/instagram-profile-scraper';

// Tighter than the default: require local part >= 3 chars to filter
// fragments like "n@something.tld". TLD must be 2-24 letters (real TLDs).
const EMAIL_REGEX = /\b[a-zA-Z0-9._%+-]{3,}@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}\b/g;

const BOILERPLATE_LOCAL_PARTS = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
  'webmaster',
]);

const BOILERPLATE_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'sample.com',
  'domain.com',
  'yourdomain.com',
  'email.com',
  'sentry.io',
  'sentry.wixpress.com',
]);

const IMAGE_SUFFIXES = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'];

function isBoilerplateEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at <= 0) return true;
  const local = email.slice(0, at).toLowerCase();
  const domain = email.slice(at + 1).toLowerCase();
  if (!local || !domain) return true;
  if (BOILERPLATE_LOCAL_PARTS.has(local)) return true;
  if (BOILERPLATE_DOMAINS.has(domain)) return true;
  if (IMAGE_SUFFIXES.some((suffix) => domain.endsWith(suffix))) return true;
  if (local.startsWith('noreply') || local.startsWith('no-reply')) return true;
  if (local.includes('example') || domain.includes('example')) return true;
  if (local.includes('test') || domain.includes('test')) return true;

  const lastDotIdx = domain.lastIndexOf('.');
  if (lastDotIdx === -1) return true;
  const tld = domain.slice(lastDotIdx + 1);
  if (!/^[a-z]{2,24}$/.test(tld)) return true;

  const PROBABLY_NAME_TLDS = new Set([
    'kirchoff',
    'jameson',
    'smith',
    'jones',
    'wilson',
  ]);
  if (PROBABLY_NAME_TLDS.has(tld)) return true;

  return false;
}

export type Stage6Result = {
  applicable: boolean;
  runSucceeded: boolean;
  emails: string[];
  error: string | null;
};

export async function scrapeIgProfileEmails(
  apify: ApifyClient,
  instagramHandle: string,
): Promise<Stage6Result> {
  const result: Stage6Result = {
    applicable: false,
    runSucceeded: false,
    emails: [],
    error: null,
  };

  const handle = instagramHandle?.trim().replace(/^@/, '');
  if (!handle) return result;

  result.applicable = true;

  try {
    const run = await apify.actor(ACTOR_ID).call({
      usernames: [handle],
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    });

    const status = run.status ? String(run.status).toUpperCase() : '';
    if (status !== 'SUCCEEDED') {
      result.error = `Apify run status: ${run.status ?? 'unknown'}`;
      return result;
    }

    result.runSucceeded = true;

    const datasetId = run.defaultDatasetId;
    if (!datasetId) {
      return result;
    }

    const { items } = await apify.dataset(datasetId).listItems();

    if (!items || items.length === 0) {
      return result;
    }

    const aggregateText: string[] = [];
    // Also collect emails from allEmails arrays directly (no regex needed).
    const directEmails: string[] = [];

    for (const item of items) {
      const obj = item as Record<string, unknown>;

      // String fields containing email-bearing text. The bio is where most
      // hand-written emails appear. businessEmail is IG's own contact field.
      for (const field of [
        'bio',
        'biography',
        'businessEmail',
        'business_email',
        'email',
        'contactEmail',
        'contact_email',
      ]) {
        const value = obj[field];
        if (typeof value === 'string') aggregateText.push(value);
      }

      // biographyWithEntities is an object whose raw_text often duplicates bio,
      // but it's worth checking explicitly since some profiles have richer text here.
      const bioEntities = obj.biographyWithEntities as Record<string, unknown> | undefined;
      if (bioEntities && typeof bioEntities.raw_text === 'string') {
        aggregateText.push(bioEntities.raw_text);
      }

      // allEmails: array of strings. The actor pre-extracts and normalizes these.
      // We read them directly — no regex needed. They've already been validated
      // by the actor's own logic.
      if (Array.isArray(obj.allEmails)) {
        for (const e of obj.allEmails) {
          if (typeof e === 'string') directEmails.push(e);
        }
      }

      // Link arrays may contain mailto: URLs or text containing emails.
      // Stringify only these specific arrays — focused enough that
      // stray text from images/comments won't pollute.
      for (const field of ['websiteLinks', 'socialLinks', 'bioLinks']) {
        const value = obj[field];
        if (Array.isArray(value)) {
          try {
            aggregateText.push(JSON.stringify(value));
          } catch {
            // skip if non-serializable
          }
        }
      }
    }

    const seen = new Set<string>();

    // First, the actor-extracted emails from allEmails. These are highest
    // confidence — already extracted by Apify's logic.
    for (const email of directEmails) {
      const lower = email.toLowerCase().trim();
      if (seen.has(lower)) continue;
      if (isBoilerplateEmail(lower)) continue;
      // Verify it's still a valid email shape (defensive)
      EMAIL_REGEX.lastIndex = 0;
      if (!EMAIL_REGEX.test(lower)) continue;
      EMAIL_REGEX.lastIndex = 0;
      seen.add(lower);
      result.emails.push(lower);
      if (result.emails.length >= 2) break;
    }

    // Then, regex-extracted emails from text fields and link arrays.
    // Only fill remaining slots after directEmails.
    if (result.emails.length < 2) {
      const combined = aggregateText.join(' ');
      const rawEmails = combined.match(EMAIL_REGEX) || [];

      for (const email of rawEmails) {
        const lower = email.toLowerCase().trim();
        if (seen.has(lower)) continue;
        if (isBoilerplateEmail(lower)) continue;
        seen.add(lower);
        result.emails.push(lower);
        if (result.emails.length >= 2) break;
      }
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}
