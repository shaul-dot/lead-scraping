import { BrightDataClient } from '@hyperscale/adapters';

// Same email regex as other stages
const EMAIL_REGEX = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

// Same boilerplate filters as Stage 1
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

export type Stage3bResult = {
  applicable: boolean;
  serpSucceeded: boolean;
  emails: string[]; // Extracted from SERP snippets
  error: string | null;
};

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

  return false;
}

/**
 * Run Stage 3b: SERP search for emails on the given domain.
 * Searches Google for queries that often surface emails in snippets.
 */
export async function discoverEmails(
  brightData: BrightDataClient,
  domain: string,
): Promise<Stage3bResult> {
  const result: Stage3bResult = {
    applicable: false,
    serpSucceeded: false,
    emails: [],
    error: null,
  };

  if (!domain?.trim()) return result;

  result.applicable = true;

  // Restrict to pages on the lead's site so snippets tend to include contiguous emails.
  const query = `site:${domain} contact email`;

  const serpResult = await brightData.runGoogleSerp(query);

  if (!serpResult.success) {
    result.error = serpResult.reason;
    return result;
  }

  result.serpSucceeded = true;

  // Aggregate text from all organic snippets and titles, extract emails.
  const aggregatedText = serpResult.organic.flatMap((r) => [r.title, r.description]).join(' ');

  const rawEmails = aggregatedText.match(EMAIL_REGEX) || [];
  const seen = new Set<string>();

  for (const e of rawEmails) {
    const lower = e.toLowerCase().trim();
    if (seen.has(lower)) continue;
    if (isBoilerplateEmail(lower)) continue;
    seen.add(lower);
    result.emails.push(lower);
  }

  return result;
}
