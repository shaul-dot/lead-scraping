import pino from 'pino';
import { ExaClient } from './client';
import { createHash, getCached, setCache } from './cache';
import { trackExaCost, isWithinBudget } from './budget';

const logger = pino({ name: 'exa-search' });

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function extractEmails(text: string): string[] {
  const matches = text.match(EMAIL_REGEX);
  if (!matches) return [];
  const unique = [...new Set(matches.map((e) => e.toLowerCase()))];
  return unique.filter(
    (e) => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.gif'),
  );
}

// Touchpoint 1: Enrichment fallback - find contact email when all APIs fail
export async function searchForContactEmail(
  fullName: string,
  companyName: string,
): Promise<{ emails: string[]; sources: string[] }> {
  const searchType = 'contact_email';
  const query = `${fullName} ${companyName} email contact`;
  const hash = createHash(query, searchType);

  try {
    const cached = await getCached(hash);
    if (cached) return cached;

    if (!(await isWithinBudget())) {
      logger.warn('Exa budget exceeded, skipping contact email search');
      return { emails: [], sources: [] };
    }

    const client = ExaClient.getInstance();
    const results = await client.search(query, {
      numResults: 5,
      type: 'auto',
      text: { maxCharacters: 2000 },
    });

    const emails: string[] = [];
    const sources: string[] = [];

    for (const result of results) {
      if (result.text) {
        const found = extractEmails(result.text);
        for (const email of found) {
          if (!emails.includes(email)) {
            emails.push(email);
            sources.push(result.url);
          }
        }
      }
    }

    const output = { emails, sources };
    await setCache(hash, query, searchType, output);
    await trackExaCost(searchType, results.length);

    return output;
  } catch (error) {
    logger.error({ error, fullName, companyName }, 'searchForContactEmail failed');
    return { emails: [], sources: [] };
  }
}

// Touchpoint 2: Landing page analysis backup - when page fetch fails
export async function searchForLandingPageContent(
  companyName: string,
  domain: string,
): Promise<{ content: string; url: string } | null> {
  const searchType = 'landing_page_content';
  const query = `${companyName} ${domain}`;
  const hash = createHash(query, searchType);

  try {
    const cached = await getCached(hash);
    if (cached) return cached;

    if (!(await isWithinBudget())) {
      logger.warn('Exa budget exceeded, skipping landing page search');
      return null;
    }

    const client = ExaClient.getInstance();
    const results = await client.search(`${companyName} site:${domain}`, {
      numResults: 3,
      type: 'auto',
      text: { maxCharacters: 5000 },
    });

    if (results.length === 0) {
      await setCache(hash, query, searchType, null);
      return null;
    }

    const best = results[0];
    const output = {
      content: best.text ?? '',
      url: best.url,
    };

    await setCache(hash, query, searchType, output);
    await trackExaCost(searchType, results.length);

    return output;
  } catch (error) {
    logger.error({ error, companyName, domain }, 'searchForLandingPageContent failed');
    return null;
  }
}

// Touchpoint 3: ICP verification for borderline leads (score 60-74)
export async function searchForIcpVerification(
  companyName: string,
): Promise<{ results: Array<{ title: string; url: string; text: string }>; signals: string[] }> {
  const searchType = 'icp_verification';
  const query = `${companyName} company product offering customers`;
  const hash = createHash(query, searchType);

  try {
    const cached = await getCached(hash);
    if (cached) return cached;

    if (!(await isWithinBudget())) {
      logger.warn('Exa budget exceeded, skipping ICP verification');
      return { results: [], signals: [] };
    }

    const client = ExaClient.getInstance();
    const rawResults = await client.search(query, {
      numResults: 5,
      type: 'neural',
      text: { maxCharacters: 3000 },
      useAutoprompt: true,
    });

    const signals: string[] = [];
    const signalPatterns = [
      { pattern: /series [a-d]|raised|funding|venture/i, label: 'funding_activity' },
      { pattern: /hiring|job opening|we're growing/i, label: 'actively_hiring' },
      { pattern: /saas|software|platform|app/i, label: 'software_company' },
      { pattern: /agency|marketing|consulting/i, label: 'agency_or_consulting' },
      { pattern: /ecommerce|e-commerce|shopify|store/i, label: 'ecommerce' },
      { pattern: /b2b|enterprise|business/i, label: 'b2b_focused' },
    ];

    for (const result of rawResults) {
      if (!result.text) continue;
      for (const { pattern, label } of signalPatterns) {
        if (pattern.test(result.text) && !signals.includes(label)) {
          signals.push(label);
        }
      }
    }

    const output = {
      results: rawResults.map((r) => ({
        title: r.title,
        url: r.url,
        text: r.text ?? '',
      })),
      signals,
    };

    await setCache(hash, query, searchType, output);
    await trackExaCost(searchType, rawResults.length);

    return output;
  } catch (error) {
    logger.error({ error, companyName }, 'searchForIcpVerification failed');
    return { results: [], signals: [] };
  }
}

// Touchpoint 4: Personalization context - recent appearances, posts, mentions
export async function searchForPersonalizationContext(
  firstName: string,
  lastName: string,
  companyName: string,
): Promise<{
  recentPodcasts: string[];
  recentPosts: string[];
  recentLaunches: string[];
  mediaMentions: string[];
  rawResults: any[];
}> {
  const searchType = 'personalization_context';
  const query = `${firstName} ${lastName} ${companyName}`;
  const hash = createHash(query, searchType);

  const empty = {
    recentPodcasts: [],
    recentPosts: [],
    recentLaunches: [],
    mediaMentions: [],
    rawResults: [],
  };

  try {
    const cached = await getCached(hash);
    if (cached) return cached;

    if (!(await isWithinBudget())) {
      logger.warn('Exa budget exceeded, skipping personalization context');
      return empty;
    }

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const client = ExaClient.getInstance();
    const results = await client.search(query, {
      numResults: 10,
      type: 'neural',
      startPublishedDate: threeMonthsAgo.toISOString().split('T')[0],
      text: { maxCharacters: 2000 },
    });

    const recentPodcasts: string[] = [];
    const recentPosts: string[] = [];
    const recentLaunches: string[] = [];
    const mediaMentions: string[] = [];

    for (const result of results) {
      const url = result.url.toLowerCase();
      const title = result.title.toLowerCase();
      const text = (result.text ?? '').toLowerCase();

      if (
        url.includes('podcast') ||
        url.includes('spotify') ||
        url.includes('apple.com/podcast') ||
        title.includes('podcast') ||
        title.includes('episode')
      ) {
        recentPodcasts.push(result.title);
      } else if (
        url.includes('linkedin.com') ||
        url.includes('twitter.com') ||
        url.includes('x.com') ||
        url.includes('medium.com') ||
        url.includes('substack')
      ) {
        recentPosts.push(result.title);
      } else if (
        text.includes('launch') ||
        text.includes('announce') ||
        text.includes('release') ||
        text.includes('introducing')
      ) {
        recentLaunches.push(result.title);
      } else {
        mediaMentions.push(result.title);
      }
    }

    const output = {
      recentPodcasts,
      recentPosts,
      recentLaunches,
      mediaMentions,
      rawResults: results,
    };

    await setCache(hash, query, searchType, output);
    await trackExaCost(searchType, results.length);

    return output;
  } catch (error) {
    logger.error({ error, firstName, lastName, companyName }, 'searchForPersonalizationContext failed');
    return empty;
  }
}

// Touchpoint 5: Keyword discovery from booked leads (weekly)
export async function findSimilarToLandingPage(
  landingPageUrl: string,
): Promise<Array<{ url: string; title: string; keywords: string[] }>> {
  const searchType = 'keyword_discovery';
  const hash = createHash(landingPageUrl, searchType);

  try {
    const cached = await getCached(hash);
    if (cached) return cached;

    if (!(await isWithinBudget())) {
      logger.warn('Exa budget exceeded, skipping keyword discovery');
      return [];
    }

    const client = ExaClient.getInstance();
    const results = await client.findSimilar(landingPageUrl, {
      numResults: 10,
      excludeSourceDomain: true,
    });

    const output = results.map((r) => {
      const keywords: string[] = [];
      const text = (r.text ?? '') + ' ' + r.title;
      const words = text.toLowerCase().split(/\s+/);
      const freq = new Map<string, number>();

      for (const word of words) {
        const clean = word.replace(/[^a-z0-9]/g, '');
        if (clean.length > 3 && clean.length < 30) {
          freq.set(clean, (freq.get(clean) ?? 0) + 1);
        }
      }

      const sorted = [...freq.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      for (const [word] of sorted) {
        keywords.push(word);
      }

      return { url: r.url, title: r.title, keywords };
    });

    await setCache(hash, landingPageUrl, searchType, output);
    await trackExaCost(searchType, results.length);

    return output;
  } catch (error) {
    logger.error({ error, landingPageUrl }, 'findSimilarToLandingPage failed');
    return [];
  }
}

// Touchpoint 6: Find alternate contact on WRONG_PERSON reply
export async function searchForAlternateContact(
  companyName: string,
): Promise<Array<{ name: string; title: string; linkedinUrl?: string }>> {
  const searchType = 'alternate_contact';
  const query = `${companyName} founder CEO owner leadership team`;
  const hash = createHash(query, searchType);

  try {
    const cached = await getCached(hash);
    if (cached) return cached;

    if (!(await isWithinBudget())) {
      logger.warn('Exa budget exceeded, skipping alternate contact search');
      return [];
    }

    const client = ExaClient.getInstance();
    const results = await client.search(query, {
      numResults: 10,
      type: 'auto',
      text: { maxCharacters: 2000 },
      category: 'linkedin profile',
    });

    const contacts: Array<{ name: string; title: string; linkedinUrl?: string }> = [];
    const titlePatterns = /(?:founder|ceo|cto|coo|cmo|owner|president|director|vp|head of|chief)/i;

    for (const result of results) {
      const text = result.text ?? '';
      const title = result.title;

      const nameMatch = title.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/);
      const titleMatch = text.match(titlePatterns) ?? title.match(titlePatterns);

      if (nameMatch && titleMatch) {
        const linkedinUrl = result.url.includes('linkedin.com') ? result.url : undefined;
        contacts.push({
          name: nameMatch[1],
          title: titleMatch[0],
          linkedinUrl,
        });
      }
    }

    const uniqueContacts = contacts.filter(
      (c, i, arr) => arr.findIndex((x) => x.name === c.name) === i,
    );

    await setCache(hash, query, searchType, uniqueContacts);
    await trackExaCost(searchType, results.length);

    return uniqueContacts;
  } catch (error) {
    logger.error({ error, companyName }, 'searchForAlternateContact failed');
    return [];
  }
}
