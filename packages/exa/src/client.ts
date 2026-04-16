import Exa from 'exa-js';
import pino from 'pino';

const logger = pino({ name: 'exa-client' });

export interface ExaSearchResult {
  url: string;
  title: string;
  text?: string;
  author?: string;
  publishedDate?: string;
  score?: number;
}

export interface SearchOptions {
  numResults?: number;
  startPublishedDate?: string;
  type?: 'neural' | 'keyword' | 'auto';
  category?: string;
  useAutoprompt?: boolean;
  text?: boolean | { maxCharacters?: number };
}

export interface FindSimilarOptions {
  numResults?: number;
  excludeSourceDomain?: boolean;
}

let instance: ExaClient | null = null;

export class ExaClient {
  private client: Exa;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.EXA_API_KEY;
    if (!key) {
      throw new Error('EXA_API_KEY is required');
    }
    this.client = new Exa(key);
  }

  static getInstance(apiKey?: string): ExaClient {
    if (!instance) {
      instance = new ExaClient(apiKey);
    }
    return instance;
  }

  async search(query: string, options?: SearchOptions): Promise<ExaSearchResult[]> {
    logger.debug({ query, options }, 'Exa search');

    const response = await this.client.search(query, {
      numResults: options?.numResults ?? 10,
      startPublishedDate: options?.startPublishedDate,
      type: options?.type ?? 'auto',
      category: options?.category,
      useAutoprompt: options?.useAutoprompt,
      text: options?.text ?? true,
    });

    return (response.results ?? []).map((r: any) => ({
      url: r.url,
      title: r.title ?? '',
      text: r.text,
      author: r.author,
      publishedDate: r.publishedDate,
      score: r.score,
    }));
  }

  async findSimilar(url: string, options?: FindSimilarOptions): Promise<ExaSearchResult[]> {
    logger.debug({ url, options }, 'Exa findSimilar');

    const response = await this.client.findSimilar(url, {
      numResults: options?.numResults ?? 10,
      excludeSourceDomain: options?.excludeSourceDomain,
    });

    return (response.results ?? []).map((r: any) => ({
      url: r.url,
      title: r.title ?? '',
      text: r.text,
      author: r.author,
      publishedDate: r.publishedDate,
      score: r.score,
    }));
  }

  async getContents(urls: string[]): Promise<ExaSearchResult[]> {
    logger.debug({ urls }, 'Exa getContents');

    const response = await this.client.getContents(urls, { text: true });

    return (response.results ?? []).map((r: any) => ({
      url: r.url,
      title: r.title ?? '',
      text: r.text,
      author: r.author,
      publishedDate: r.publishedDate,
    }));
  }
}
