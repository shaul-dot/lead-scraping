import { createLogger } from './logger';

const logger = createLogger('landing-page-fetcher');

export interface LandingPageResult {
  html: string;
  text: string;
  title: string;
  h1: string;
  description: string;
  emails: string[];
  termsUrl?: string;
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TIMEOUT_MS = 15_000;

export async function fetchLandingPage(url: string): Promise<LandingPageResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn({ url, status: response.status }, 'Landing page fetch failed');
      return null;
    }

    const html = await response.text();
    const text = stripHtml(html);
    const title = extractTag(html, 'title');
    const h1 = extractTag(html, 'h1');
    const description = extractMetaDescription(html);
    const emails = [...new Set(text.match(EMAIL_REGEX) || [])];
    const termsUrl = extractTermsLink(html, url);

    if (termsUrl) {
      try {
        const termsResponse = await fetch(termsUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          redirect: 'follow',
          signal: AbortSignal.timeout(10_000),
        });
        if (termsResponse.ok) {
          const termsHtml = await termsResponse.text();
          const termsText = stripHtml(termsHtml);
          const termsEmails = termsText.match(EMAIL_REGEX) || [];
          for (const email of termsEmails) {
            if (!emails.includes(email)) emails.push(email);
          }
        }
      } catch {
        // Terms page fetch is best-effort
      }
    }

    return { html, text, title, h1, description, emails, termsUrl };
  } catch (err) {
    logger.warn({ url, err }, 'Landing page fetch error');
    return null;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(html: string, tag: string): string {
  const match = html.match(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'is'));
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
}

function extractMetaDescription(html: string): string {
  const match =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  return match ? match[1].trim() : '';
}

function extractTermsLink(html: string, baseUrl: string): string | undefined {
  const match = html.match(/<a[^>]*href=["']([^"']*(?:terms|privacy|legal|conditions)[^"']*)["']/i);
  if (!match) return undefined;
  try {
    return new URL(match[1], baseUrl).href;
  } catch {
    return undefined;
  }
}
