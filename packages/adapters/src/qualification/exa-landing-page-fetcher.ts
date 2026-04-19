import Exa from 'exa-js';

import type { LandingPageFetcher, LandingPageResult } from './landing-page-fetcher';

const MAX_CHARS = 10_000;

function trimContent(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CHARS) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_CHARS);
}

function failureReasonFromError(err: unknown): string {
  if (err && typeof err === 'object') {
    const anyErr = err as Record<string, unknown>;
    const status = anyErr.statusCode ?? anyErr.status ?? anyErr.code;
    if (status === 429 || status === '429') {
      return 'rate_limited';
    }
    if (status === 404 || status === '404') {
      return 'not_found';
    }
    const name = typeof anyErr.name === 'string' ? anyErr.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
      return 'timeout';
    }
    const message = typeof anyErr.message === 'string' ? anyErr.message.toLowerCase() : '';
    if (message.includes('timeout') || message.includes('timed out') || message.includes('etimedout')) {
      return 'timeout';
    }
    if (message.includes('429') || message.includes('rate limit')) {
      return 'rate_limited';
    }
    if (message.includes('404') || message.includes('not found')) {
      return 'not_found';
    }
  }
  return 'fetch_failed';
}

export class ExaLandingPageFetcher implements LandingPageFetcher {
  private readonly client: Exa;

  constructor(private readonly exaApiKey: string) {
    this.client = new Exa(exaApiKey);
  }

  async fetch(url: string): Promise<LandingPageResult> {
    const normalized = url.trim();
    if (!normalized) {
      return { success: false, reason: 'invalid_url' };
    }

    try {
      const response = await this.client.getContents([normalized], { text: true });
      const first = response.results?.[0] as { text?: string } | undefined;
      const text = typeof first?.text === 'string' ? first.text : '';

      if (!text.trim()) {
        return { success: false, reason: 'empty_content' };
      }

      return { success: true, content: trimContent(text) };
    } catch (err) {
      return { success: false, reason: failureReasonFromError(err) };
    }
  }
}
