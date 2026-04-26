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
import { IgGoogleNicheService } from './ig-google-niche.service';

describe('IgGoogleNicheService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRIGHT_DATA_API_TOKEN = 'x';
  });

  it('No identity keywords available -> returns zeros, no Google search', async () => {
    (prisma.keyword.findMany as any).mockResolvedValue([]);
    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGoogleNicheService(queueService);

    const out = await svc.runOneCycle(3, 'CA');
    expect(out).toEqual({
      keywordsUsed: 0,
      queriesSucceeded: 0,
      totalResultsReturned: 0,
      candidatesEnqueued: 0,
      candidatesSkippedDuplicates: 0,
    });

    expect(prisma.keyword.updateMany).not.toHaveBeenCalled();
  });

  it('Keywords available, Google returns profile URLs -> enqueues candidates, lastUsedAt updated', async () => {
    (prisma.keyword.findMany as any).mockResolvedValue([
      { id: 'k1', primary: 'menopause coach', lastUsedAt: null },
      { id: 'k2', primary: 'manifestation coach', lastUsedAt: null },
    ]);

    const googleSearch = vi.fn(async () => [
      { link: 'https://www.instagram.com/some.handle/', title: 'x', description: 'd', rank: 1, query: 'q1' },
      { url: 'https://instagram.com/another_handle', title: 'y', description: null, rank: 2, keyword: 'q2' },
      { link: 'https://www.instagram.com/p/CXYZ123/', title: 'post', rank: 3 }, // not profile
      { link: 'https://www.instagram.com/explore/tags/menopause/', title: 'tag', rank: 4 }, // not profile
    ]);

    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.googleSearch = googleSearch;
      return this;
    });

    (prisma.igCandidateProfile.create as any).mockImplementation(async ({ data }: any) => ({
      id: `c_${data.instagramHandle}`,
    }));

    const queueService = { addJob: vi.fn(async () => 'job') } as any;
    const svc = new IgGoogleNicheService(queueService);

    const out = await svc.runOneCycle(2, 'US');
    expect(out.keywordsUsed).toBe(2);
    expect(out.queriesSucceeded).toBe(2);
    expect(out.totalResultsReturned).toBe(4);
    expect(out.candidatesEnqueued).toBe(2);
    expect(out.candidatesSkippedDuplicates).toBe(0);

    expect(prisma.keyword.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['k1', 'k2'] } },
      data: { lastUsedAt: expect.any(Date) },
    });

    expect(queueService.addJob).toHaveBeenCalledTimes(2);

    expect(googleSearch).toHaveBeenCalledWith(expect.any(Array), { country: 'US' });

    // Persists rotation country into metadata
    expect(prisma.igCandidateProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceMetadata: expect.objectContaining({ rotationCountry: 'US' }),
        }),
      }),
    );
  });

  it('Bright Data SERP fails -> returns zeros, lastUsedAt still updated', async () => {
    (prisma.keyword.findMany as any).mockResolvedValue([
      { id: 'k1', primary: 'menopause coach', lastUsedAt: null },
    ]);

    const googleSearch = vi.fn(async () => {
      throw new Error('boom');
    });
    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.googleSearch = googleSearch;
      return this;
    });

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGoogleNicheService(queueService);

    const out = await svc.runOneCycle(1, 'UK');
    expect(out).toEqual({
      keywordsUsed: 1,
      queriesSucceeded: 0,
      totalResultsReturned: 0,
      candidatesEnqueued: 0,
      candidatesSkippedDuplicates: 0,
    });

    expect(prisma.keyword.updateMany).toHaveBeenCalled();
    expect(googleSearch).toHaveBeenCalledWith(expect.any(Array), { country: 'UK' });
  });

  it('Duplicate candidate (P2002) -> counted as skipped, does not crash', async () => {
    (prisma.keyword.findMany as any).mockResolvedValue([
      { id: 'k1', primary: 'menopause coach', lastUsedAt: null },
    ]);

    const googleSearch = vi.fn(async () => [
      { link: 'https://www.instagram.com/some.handle/', title: 'x', description: 'd', rank: 1, query: 'q1' },
    ]);
    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.googleSearch = googleSearch;
      return this;
    });

    (prisma.igCandidateProfile.create as any).mockRejectedValue({ code: 'P2002' });

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGoogleNicheService(queueService);

    const out = await svc.runOneCycle(1);
    expect(out.candidatesEnqueued).toBe(0);
    expect(out.candidatesSkippedDuplicates).toBe(1);
    expect(queueService.addJob).not.toHaveBeenCalled();
  });

  it('Job enqueue fails -> logged and does not crash cycle', async () => {
    (prisma.keyword.findMany as any).mockResolvedValue([
      { id: 'k1', primary: 'menopause coach', lastUsedAt: null },
    ]);

    const googleSearch = vi.fn(async () => [
      { link: 'https://www.instagram.com/some.handle/', title: 'x', description: 'd', rank: 1, query: 'q1' },
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

    const svc = new IgGoogleNicheService(queueService);
    const out = await svc.runOneCycle(1);
    expect(out.keywordsUsed).toBe(1);
  });

  it('Result URL is not a profile (/p/, /reel/, /explore/) -> skipped', async () => {
    (prisma.keyword.findMany as any).mockResolvedValue([
      { id: 'k1', primary: 'menopause coach', lastUsedAt: null },
    ]);

    const googleSearch = vi.fn(async () => [
      { link: 'https://www.instagram.com/p/CXYZ123/' },
      { link: 'https://www.instagram.com/reel/DTgLNkKk9ZM/' },
      { link: 'https://www.instagram.com/explore/tags/menopause/' },
    ]);

    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.googleSearch = googleSearch;
      return this;
    });

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGoogleNicheService(queueService);

    const out = await svc.runOneCycle(1);
    expect(out.totalResultsReturned).toBe(3);
    expect(out.candidatesEnqueued).toBe(0);
    expect(prisma.igCandidateProfile.create).not.toHaveBeenCalled();
    expect(queueService.addJob).not.toHaveBeenCalled();
  });
});

