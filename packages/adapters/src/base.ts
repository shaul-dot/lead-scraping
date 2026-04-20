import { prisma, Source, SourceTier } from '@hyperscale/database';
import pino from 'pino';

export interface LeadInput {
  companyName: string;
  sourceUrl: string;
  source: string;
  firstName?: string;
  fullName?: string;
  title?: string;
  email?: string;
  websiteUrl?: string;
  linkedinUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  phoneNumber?: string;
  adCreativeId?: string;
  landingPageUrl?: string;
  sourceHandle?: string;
  country?: string;
  adText?: string;
}

export interface AdapterResult {
  leads: LeadInput[];
  metadata: {
    source: string;
    tier: string;
    keyword: string;
    leadsFound: number;
    costEstimate: number;
    durationMs: number;
    /** Top rejection reasons from qualifyAd (Facebook Tier 2), sorted by count descending. */
    rejectedByReason?: Record<string, number>;
    /** Count of rejections not listed in rejectedByReason (beyond top 8 distinct reasons). */
    otherRejected?: number;
  };
}

export abstract class BaseAdapter {
  protected logger: pino.Logger;
  protected source: string;

  constructor(source: string) {
    this.source = source;
    this.logger = pino({ name: `adapter:${source}` });
  }

  abstract scrape(
    keyword: string,
    options?: { country?: string; maxResults?: number },
  ): Promise<AdapterResult>;

  abstract healthCheck(): Promise<{ healthy: boolean; message?: string }>;

  protected async createScrapeJob(keyword: string, tier: string): Promise<string> {
    const job = await prisma.scrapeJob.create({
      data: {
        source: this.mapSource(),
        sourceTier: this.mapTier(tier),
        keyword,
        status: 'running',
        startedAt: new Date(),
      },
    });
    return job.id;
  }

  protected async completeScrapeJob(jobId: string, result: AdapterResult): Promise<void> {
    await prisma.scrapeJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        leadsFound: result.metadata.leadsFound,
        leadsAdded: result.leads.length,
        costUsd: result.metadata.costEstimate,
        finishedAt: new Date(),
      },
    });
  }

  protected async failScrapeJob(jobId: string, error: string): Promise<void> {
    await prisma.scrapeJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        errorLog: error,
        finishedAt: new Date(),
      },
    });
  }

  protected normalizeCompanyName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\b(llc|inc|ltd|corp|co|llp|pllc|plc|gmbh|s\.?a\.?|limited|incorporated|corporation)\b\.?/gi, '')
      .replace(/[,.\-]+$/, '')
      .trim();
  }

  private mapSource(): Source {
    const mapping: Record<string, Source> = {
      facebook_ads: 'FACEBOOK_ADS',
      instagram: 'INSTAGRAM',
    };
    return mapping[this.source] ?? 'FACEBOOK_ADS';
  }

  private mapTier(tier: string): SourceTier {
    const mapping: Record<string, SourceTier> = {
      tier1: 'TIER_1_API',
      tier2: 'TIER_2_MANAGED',
      tier3: 'TIER_3_INHOUSE',
    };
    return mapping[tier] ?? 'TIER_2_MANAGED';
  }
}
