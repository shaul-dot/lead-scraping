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
import { IgGoogleFunnelService } from './ig-google-funnel.service';

describe('IgGoogleFunnelService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRIGHT_DATA_API_TOKEN = 'x';
  });

  it('No niche keywords -> returns zeros, no SERP call', async () => {
    (prisma.keyword.findMany as any)
      .mockResolvedValueOnce([]) // niches
      .mockResolvedValueOnce([{ id: 'f1', primary: 'webinar' }]); // funnels

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGoogleFunnelService(queueService);

    const out = await svc.runOneCycle(2);
    expect(out).toEqual({
      combinationsUsed: 0,
      totalResultsReturned: 0,
      candidatesEnqueued: 0,
      candidatesSkippedDuplicates: 0,
    });
    expect(prisma.keyword.updateMany).not.toHaveBeenCalled();
  });

  it('No funnel keywords -> returns zeros, no SERP call', async () => {
    (prisma.keyword.findMany as any)
      .mockResolvedValueOnce([{ id: 'n1', primary: 'menopause coach' }]) // niches
      .mockResolvedValueOnce([]); // funnels

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGoogleFunnelService(queueService);

    const out = await svc.runOneCycle(2);
    expect(out.combinationsUsed).toBe(0);
    expect(out.totalResultsReturned).toBe(0);
    expect(prisma.keyword.updateMany).not.toHaveBeenCalled();
  });

  it('Niches and funnels available -> pairs them, runs SERP, enqueues candidates', async () => {
    (prisma.keyword.findMany as any)
      .mockResolvedValueOnce([
        { id: 'n1', primary: 'menopause coach' },
        { id: 'n2', primary: 'manifestation coach' },
      ])
      .mockResolvedValueOnce([
        { id: 'f1', primary: 'webinar' },
        { id: 'f2', primary: 'application form' },
      ]);

    const googleSearch = vi.fn(async () => [
      { link: 'https://www.instagram.com/some.handle/' },
      { url: 'https://instagram.com/another_handle' },
      { link: 'https://www.instagram.com/p/CXYZ123/' }, // not profile
    ]);
    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.googleSearch = googleSearch;
      return this;
    });

    (prisma.igCandidateProfile.create as any).mockImplementation(async ({ data }: any) => ({
      id: `c_${data.instagramHandle}`,
    }));

    const queueService = { addJob: vi.fn(async () => 'job') } as any;
    const svc = new IgGoogleFunnelService(queueService);

    const out = await svc.runOneCycle(2);
    expect(out.combinationsUsed).toBe(2);
    expect(out.totalResultsReturned).toBe(3);
    expect(out.candidatesEnqueued).toBe(2);
    expect(out.candidatesSkippedDuplicates).toBe(0);

    expect(prisma.keyword.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['n1', 'n2', 'f1', 'f2'] } },
      data: { lastUsedAt: expect.any(Date) },
    });
    expect(queueService.addJob).toHaveBeenCalledTimes(2);
  });

  it('More niches than funnels (or vice versa) -> uses min count, does not crash', async () => {
    (prisma.keyword.findMany as any)
      .mockResolvedValueOnce([
        { id: 'n1', primary: 'a' },
        { id: 'n2', primary: 'b' },
        { id: 'n3', primary: 'c' },
      ])
      .mockResolvedValueOnce([{ id: 'f1', primary: 'x' }]);

    const googleSearch = vi.fn(async () => []);
    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.googleSearch = googleSearch;
      return this;
    });

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGoogleFunnelService(queueService);

    const out = await svc.runOneCycle(10);
    expect(out.combinationsUsed).toBe(1);
    expect(prisma.keyword.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['n1', 'f1'] } },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it('Bright Data fails -> returns zeros, lastUsedAt still updated', async () => {
    (prisma.keyword.findMany as any)
      .mockResolvedValueOnce([{ id: 'n1', primary: 'a' }])
      .mockResolvedValueOnce([{ id: 'f1', primary: 'x' }]);

    const googleSearch = vi.fn(async () => {
      throw new Error('boom');
    });
    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.googleSearch = googleSearch;
      return this;
    });

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGoogleFunnelService(queueService);

    const out = await svc.runOneCycle(1);
    expect(out).toEqual({
      combinationsUsed: 1,
      totalResultsReturned: 0,
      candidatesEnqueued: 0,
      candidatesSkippedDuplicates: 0,
    });
    expect(prisma.keyword.updateMany).toHaveBeenCalled();
  });

  it('Duplicate candidate (P2002) -> counted as skipped', async () => {
    (prisma.keyword.findMany as any)
      .mockResolvedValueOnce([{ id: 'n1', primary: 'a' }])
      .mockResolvedValueOnce([{ id: 'f1', primary: 'x' }]);

    const googleSearch = vi.fn(async () => [{ link: 'https://www.instagram.com/some.handle/' }]);
    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.googleSearch = googleSearch;
      return this;
    });

    (prisma.igCandidateProfile.create as any).mockRejectedValue({ code: 'P2002' });

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGoogleFunnelService(queueService);

    const out = await svc.runOneCycle(1);
    expect(out.candidatesEnqueued).toBe(0);
    expect(out.candidatesSkippedDuplicates).toBe(1);
    expect(queueService.addJob).not.toHaveBeenCalled();
  });

  it('Job enqueue fails -> logged and does not crash cycle', async () => {
    (prisma.keyword.findMany as any)
      .mockResolvedValueOnce([{ id: 'n1', primary: 'a' }])
      .mockResolvedValueOnce([{ id: 'f1', primary: 'x' }]);

    const googleSearch = vi.fn(async () => [{ link: 'https://www.instagram.com/some.handle/' }]);
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

    const svc = new IgGoogleFunnelService(queueService);
    const out = await svc.runOneCycle(1);
    expect(out.combinationsUsed).toBe(1);
  });
});

