import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@hyperscale/database', () => {
  return {
    prisma: {
      keyword: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      igCandidateProfile: {
        create: vi.fn(),
      },
    },
  };
});

vi.mock('@hyperscale/adapters/brightdata', () => {
  return {
    BrightDataClient: vi.fn().mockImplementation(function (this: any) {
      this.googleSearch = vi.fn();
      return this;
    }),
  };
});

import { prisma } from '@hyperscale/database';
import { BrightDataClient } from '@hyperscale/adapters/brightdata';
import { IgGoogleAggregatorService } from './ig-google-aggregator.service';

describe('IgGoogleAggregatorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRIGHT_DATA_API_TOKEN = 'x';
  });

  it('No identity keywords -> returns zeros', async () => {
    (prisma.keyword.findMany as any).mockResolvedValue([]);
    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGoogleAggregatorService(queueService);

    const out = await svc.runOneCycle(3);
    expect(out).toEqual({
      keywordsUsed: 0,
      totalQueries: 0,
      totalResultsReturned: 0,
      candidatesEnqueued: 0,
      candidatesSkippedDuplicates: 0,
      handlesExtractedNone: 0,
    });
    expect(prisma.keyword.updateMany).not.toHaveBeenCalled();
  });

  it('3 keywords × 4 sites -> 12 queries built; SERP results processed', async () => {
    (prisma.keyword.findMany as any).mockResolvedValue([
      { id: 'k1', primary: 'menopause coach' },
      { id: 'k2', primary: 'manifestation coach' },
      { id: 'k3', primary: 'fitness coach' },
    ]);

    const googleSearch = vi.fn(async (queries: string[]) => {
      expect(queries).toHaveLength(12);
      return [
        // handle in description
        { link: 'https://linktr.ee/whatever', title: 't1', description: 'Follow @sarahcoach', query: 'q1' },
        // handle in title
        { link: 'https://beacons.ai/whatever', title: 'Coach (@titlehandle)', description: null, query: 'q2' },
        // url fallback
        { link: 'https://stan.store/urlhandle', title: null, description: null, query: 'q3' },
        // reserved path
        { link: 'https://linktr.ee/blog', title: null, description: null, query: 'q4' },
        // subdomain rejected
        { link: 'https://coach.stan.store/sign-up', title: null, description: null, query: 'q5' },
        // none extractable
        { link: 'https://bento.me/pages', title: 'no handle here', description: 'still none', query: 'q6' },
      ];
    });
    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.googleSearch = googleSearch;
      return this;
    });

    (prisma.igCandidateProfile.create as any).mockImplementation(async ({ data }: any) => ({
      id: `c_${data.instagramHandle}`,
    }));

    const queueService = { addJob: vi.fn(async () => 'job') } as any;
    const svc = new IgGoogleAggregatorService(queueService);

    const out = await svc.runOneCycle(3, 'UK');
    expect(out.keywordsUsed).toBe(3);
    expect(out.totalQueries).toBe(12);
    expect(out.totalResultsReturned).toBe(6);
    expect(out.candidatesEnqueued).toBe(3);
    expect(out.candidatesSkippedDuplicates).toBe(0);
    expect(out.handlesExtractedNone).toBe(3);

    expect(queueService.addJob).toHaveBeenCalledTimes(3);
    expect(googleSearch).toHaveBeenCalledWith(expect.any(Array), { country: 'UK' });
    expect(prisma.igCandidateProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceMetadata: expect.objectContaining({ rotationCountry: 'UK' }),
        }),
      }),
    );
    expect(prisma.keyword.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['k1', 'k2', 'k3'] } },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it('Bright Data fails -> returns zeros, lastUsedAt still updated', async () => {
    (prisma.keyword.findMany as any).mockResolvedValue([{ id: 'k1', primary: 'menopause coach' }]);

    const googleSearch = vi.fn(async () => {
      throw new Error('boom');
    });
    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.googleSearch = googleSearch;
      return this;
    });

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGoogleAggregatorService(queueService);
    const out = await svc.runOneCycle(1);

    expect(out).toEqual({
      keywordsUsed: 1,
      totalQueries: 4,
      totalResultsReturned: 0,
      candidatesEnqueued: 0,
      candidatesSkippedDuplicates: 0,
      handlesExtractedNone: 0,
    });
    expect(prisma.keyword.updateMany).toHaveBeenCalled();
  });

  it('Duplicate (P2002) -> counted as skipped', async () => {
    (prisma.keyword.findMany as any).mockResolvedValue([{ id: 'k1', primary: 'menopause coach' }]);
    const googleSearch = vi.fn(async () => [
      { link: 'https://linktr.ee/urlhandle', description: null, title: null },
    ]);
    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.googleSearch = googleSearch;
      return this;
    });

    (prisma.igCandidateProfile.create as any).mockRejectedValue({ code: 'P2002' });

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGoogleAggregatorService(queueService);
    const out = await svc.runOneCycle(1);

    expect(out.candidatesEnqueued).toBe(0);
    expect(out.candidatesSkippedDuplicates).toBe(1);
  });

  it('Job enqueue fails -> logged and does not crash', async () => {
    (prisma.keyword.findMany as any).mockResolvedValue([{ id: 'k1', primary: 'menopause coach' }]);
    const googleSearch = vi.fn(async () => [
      { link: 'https://linktr.ee/urlhandle', description: null, title: null },
    ]);
    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.googleSearch = googleSearch;
      return this;
    });
    (prisma.igCandidateProfile.create as any).mockResolvedValue({ id: 'c1' });

    const queueService = {
      addJob: vi.fn(async () => {
        throw new Error('redis');
      }),
    } as any;

    const svc = new IgGoogleAggregatorService(queueService);
    const out = await svc.runOneCycle(1);
    expect(out.keywordsUsed).toBe(1);
  });
});

