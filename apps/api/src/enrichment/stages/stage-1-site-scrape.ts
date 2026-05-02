import { ExaLandingPageFetcher } from '@hyperscale/adapters/qualification';

// Same email regex as Stage 0
const EMAIL_REGEX = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

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

// Pages to try: homepage first, then contact variants in parallel, then legal/about variants in parallel.
type PageFetch = { path: string; label: string };

const HOMEPAGE: PageFetch = { path: '', label: 'homepage' };

// Contact pages — try in parallel since variations are common.
const CONTACT_PAGES: PageFetch[] = [
  { path: '/contact', label: 'contact' },
  { path: '/contact-us', label: 'contact' },
];

// Legal / about pages — parallel sweep with multiple naming conventions per page type.
const LEGAL_AND_ABOUT_PAGES: PageFetch[] = [
  { path: '/privacy', label: 'privacy' },
  { path: '/privacy-policy', label: 'privacy' },
  { path: '/terms', label: 'terms' },
  { path: '/terms-of-service', label: 'terms' },
  { path: '/terms-of-use', label: 'terms' },
  { path: '/terms-and-conditions', label: 'terms' },
  { path: '/about', label: 'about' },
  { path: '/about-us', label: 'about' },
];

export type Stage1EmailHit = {
  address: string;
  page: string; // 'homepage' | 'contact' | 'privacy' | 'terms' | 'about'
};

export type Stage1Result = {
  emails: Stage1EmailHit[];
  pagesAttempted: number;
  pagesSucceeded: number;
  errors: string[]; // Errors from individual page fetches; not fatal
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
  if (local.startsWith('donotreply') || local.startsWith('do-not-reply')) return true;
  if (local === 'your.email') return true;
  if (local.includes('example') || domain.includes('example')) return true;
  if (local.includes('test') || domain.includes('test')) return true;
  if (local.includes('sample') || domain.includes('sample')) return true;

  return false;
}

/**
 * Build a fully-qualified URL from a base domain and a path.
 */
function buildUrl(domain: string, path: string): string {
  const base = domain.startsWith('http') ? domain : `https://${domain}`;
  const trimmedBase = base.replace(/\/+$/, ''); // strip trailing slashes
  return path ? `${trimmedBase}${path}` : trimmedBase;
}

/**
 * Fetch a single page and extract emails. Returns null on fetch failure
 * (so caller can decide whether to continue or stop).
 */
async function fetchPageEmails(
  fetcher: ExaLandingPageFetcher,
  url: string,
  pageLabel: string,
): Promise<{ emails: Stage1EmailHit[]; error: string | null }> {
  try {
    const lp = await fetcher.fetch(url);
    if (!lp.success) {
      return { emails: [], error: lp.reason };
    }

    const rawEmails = lp.content.match(EMAIL_REGEX) || [];
    const seen = new Set<string>();
    const hits: Stage1EmailHit[] = [];
    for (const e of rawEmails) {
      const lower = e.toLowerCase().trim();
      if (seen.has(lower)) continue;
      if (isBoilerplateEmail(lower)) continue;
      seen.add(lower);
      hits.push({ address: lower, page: pageLabel });
    }
    return { emails: hits, error: null };
  } catch (err) {
    return { emails: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run Stage 1: homepage, then contact path variants in parallel, then legal/about variants in parallel.
 * Short-circuit after homepage or contact batch if any emails found.
 */
export async function scrapeSite(domain: string): Promise<Stage1Result> {
  const result: Stage1Result = {
    emails: [],
    pagesAttempted: 0,
    pagesSucceeded: 0,
    errors: [],
  };

  const trimmed = domain?.trim() ?? '';
  if (!trimmed) {
    return result;
  }

  const apiKey = process.env.EXA_API_KEY?.trim();
  if (!apiKey) {
    result.errors.push('EXA_API_KEY not configured');
    return result;
  }

  const fetcher = new ExaLandingPageFetcher(apiKey);

  // Step 1: homepage
  result.pagesAttempted++;
  const homepageResult = await fetchPageEmails(fetcher, buildUrl(trimmed, HOMEPAGE.path), HOMEPAGE.label);
  if (homepageResult.error) {
    result.errors.push(`${HOMEPAGE.label}: ${homepageResult.error}`);
  } else {
    result.pagesSucceeded++;
  }
  if (homepageResult.emails.length > 0) {
    result.emails.push(...homepageResult.emails);
    return result; // Short-circuit
  }

  // Step 2: contact pages in parallel
  const contactResults = await Promise.all(
    CONTACT_PAGES.map((page) => fetchPageEmails(fetcher, buildUrl(trimmed, page.path), page.label)),
  );
  const contactSeen = new Set<string>();
  const contactEmails: Stage1EmailHit[] = [];
  for (let i = 0; i < contactResults.length; i++) {
    const cr = contactResults[i];
    const pagePath = CONTACT_PAGES[i].path;
    result.pagesAttempted++;
    if (cr.error) {
      result.errors.push(`${pagePath}: ${cr.error}`);
    } else {
      result.pagesSucceeded++;
    }
    for (const hit of cr.emails) {
      if (contactSeen.has(hit.address)) continue;
      contactSeen.add(hit.address);
      contactEmails.push(hit);
    }
  }
  if (contactEmails.length > 0) {
    result.emails.push(...contactEmails);
    return result; // Short-circuit
  }

  // Step 3: legal + about pages in parallel
  const legalResults = await Promise.all(
    LEGAL_AND_ABOUT_PAGES.map((page) => fetchPageEmails(fetcher, buildUrl(trimmed, page.path), page.label)),
  );
  const legalSeen = new Set<string>();
  for (let i = 0; i < legalResults.length; i++) {
    const lr = legalResults[i];
    const pagePath = LEGAL_AND_ABOUT_PAGES[i].path;
    result.pagesAttempted++;
    if (lr.error) {
      result.errors.push(`${pagePath}: ${lr.error}`);
    } else {
      result.pagesSucceeded++;
    }
    for (const hit of lr.emails) {
      if (legalSeen.has(hit.address)) continue;
      legalSeen.add(hit.address);
      result.emails.push(hit);
    }
  }

  return result;
}
