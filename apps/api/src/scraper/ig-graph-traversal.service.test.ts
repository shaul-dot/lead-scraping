import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@hyperscale/database', () => {
  return {
    prisma: {
      knownAdvertiser: {
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
      this.scrapeInstagramProfiles = vi.fn();
      return this;
    }),
  };
});

import { prisma } from '@hyperscale/database';
import { BrightDataClient } from '@hyperscale/adapters/brightdata';
import { IgGraphTraversalService } from './ig-graph-traversal.service';

describe('IgGraphTraversalService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRIGHT_DATA_API_TOKEN = 'x';
  });

  it('No seeds available -> returns zeros, no scrape attempted', async () => {
    (prisma.knownAdvertiser.findMany as any).mockResolvedValue([]);
    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGraphTraversalService(queueService);

    const out = await svc.runOneCycle(3);
    expect(out).toEqual({
      seedsUsed: 0,
      candidatesEnqueued: 0,
      candidatesSkippedDuplicates: 0,
      scrapeErrors: 0,
    });
    expect(prisma.knownAdvertiser.updateMany).not.toHaveBeenCalled();
  });

  it('Seeds returned, scrape succeeds, related accounts enqueued; lastTraversedAt updated', async () => {
    (prisma.knownAdvertiser.findMany as any).mockResolvedValue([
      { id: 's1', instagramHandle: 'seed1', lastTraversedAt: null },
      { id: 's2', instagramHandle: 'seed2', lastTraversedAt: null },
    ]);

    const scrape = vi.fn(async () => [
      {
        account: 'seed1',
        related_accounts: [
          { account: 'rel1', profile_url: 'https://www.instagram.com/rel1/', full_name: 'R1' },
          { account: 'rel2', profile_url: 'https://www.instagram.com/rel2/', full_name: 'R2' },
        ],
      },
      {
        account: 'seed2',
        related_accounts: [
          { account: 'rel3', profile_url: 'https://www.instagram.com/rel3/', full_name: 'R3' },
        ],
      },
    ]);

    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.scrapeInstagramProfiles = scrape;
      return this;
    });

    (prisma.igCandidateProfile.create as any).mockImplementation(async ({ data }: any) => {
      return { id: `c_${data.instagramHandle}` };
    });

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGraphTraversalService(queueService);

    const out = await svc.runOneCycle(2);
    expect(out.seedsUsed).toBe(2);
    expect(out.candidatesEnqueued).toBe(3);
    expect(out.candidatesSkippedDuplicates).toBe(0);
    expect(out.scrapeErrors).toBe(0);

    expect(prisma.knownAdvertiser.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['s1', 's2'] } },
      data: { lastTraversedAt: expect.any(Date) },
    });

    expect(queueService.addJob).toHaveBeenCalledTimes(3);
  });

  it('Bright Data scrape fails -> lastTraversedAt updated, returns scrapeErrors=seedCount', async () => {
    (prisma.knownAdvertiser.findMany as any).mockResolvedValue([
      { id: 's1', instagramHandle: 'seed1', lastTraversedAt: null },
      { id: 's2', instagramHandle: 'seed2', lastTraversedAt: null },
      { id: 's3', instagramHandle: 'seed3', lastTraversedAt: null },
    ]);

    const scrape = vi.fn(async () => {
      throw new Error('boom');
    });
    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.scrapeInstagramProfiles = scrape;
      return this;
    });

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGraphTraversalService(queueService);

    const out = await svc.runOneCycle(3);
    expect(out).toEqual({
      seedsUsed: 3,
      candidatesEnqueued: 0,
      candidatesSkippedDuplicates: 0,
      scrapeErrors: 3,
    });

    expect(prisma.knownAdvertiser.updateMany).toHaveBeenCalled();
    expect(queueService.addJob).not.toHaveBeenCalled();
  });

  it('Bright Data returns fewer profiles than seeds -> scrapeErrors reflects difference', async () => {
    (prisma.knownAdvertiser.findMany as any).mockResolvedValue([
      { id: 's1', instagramHandle: 'seed1', lastTraversedAt: null },
      { id: 's2', instagramHandle: 'seed2', lastTraversedAt: null },
      { id: 's3', instagramHandle: 'seed3', lastTraversedAt: null },
    ]);

    const scrape = vi.fn(async () => [
      { account: 'seed1', related_accounts: [] },
      { account: 'seed2', related_accounts: [] },
    ]);

    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.scrapeInstagramProfiles = scrape;
      return this;
    });

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGraphTraversalService(queueService);

    const out = await svc.runOneCycle(3);
    expect(out.seedsUsed).toBe(3);
    expect(out.scrapeErrors).toBe(1);
  });

  it('Duplicate candidate (P2002) -> counted as skipped, does not crash', async () => {
    (prisma.knownAdvertiser.findMany as any).mockResolvedValue([
      { id: 's1', instagramHandle: 'seed1', lastTraversedAt: null },
    ]);

    const scrape = vi.fn(async () => [
      {
        account: 'seed1',
        related_accounts: [{ account: 'rel1', profile_url: 'https://www.instagram.com/rel1/' }],
      },
    ]);

    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.scrapeInstagramProfiles = scrape;
      return this;
    });

    (prisma.igCandidateProfile.create as any).mockRejectedValue({ code: 'P2002' });

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGraphTraversalService(queueService);

    const out = await svc.runOneCycle(1);
    expect(out.candidatesEnqueued).toBe(0);
    expect(out.candidatesSkippedDuplicates).toBe(1);
    expect(queueService.addJob).not.toHaveBeenCalled();
  });

  it('Profile has no related_accounts -> skipped silently', async () => {
    (prisma.knownAdvertiser.findMany as any).mockResolvedValue([
      { id: 's1', instagramHandle: 'seed1', lastTraversedAt: null },
    ]);

    const scrape = vi.fn(async () => [{ account: 'seed1', related_accounts: null }]);
    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.scrapeInstagramProfiles = scrape;
      return this;
    });

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGraphTraversalService(queueService);

    const out = await svc.runOneCycle(1);
    expect(out.candidatesEnqueued).toBe(0);
  });

  it('Related account fails normalization -> skipped silently', async () => {
    (prisma.knownAdvertiser.findMany as any).mockResolvedValue([
      { id: 's1', instagramHandle: 'seed1', lastTraversedAt: null },
    ]);

    const scrape = vi.fn(async () => [
      {
        account: 'seed1',
        related_accounts: [{ account: 'bad!handle', profile_url: 'https://www.instagram.com/bad!handle/' }],
      },
    ]);
    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.scrapeInstagramProfiles = scrape;
      return this;
    });

    const queueService = { addJob: vi.fn() } as any;
    const svc = new IgGraphTraversalService(queueService);

    const out = await svc.runOneCycle(1);
    expect(out.candidatesEnqueued).toBe(0);
    expect(prisma.igCandidateProfile.create).not.toHaveBeenCalled();
  });

  it('Job enqueue fails -> does not crash cycle', async () => {
    (prisma.knownAdvertiser.findMany as any).mockResolvedValue([
      { id: 's1', instagramHandle: 'seed1', lastTraversedAt: null },
    ]);

    const scrape = vi.fn(async () => [
      {
        account: 'seed1',
        related_accounts: [{ account: 'rel1', profile_url: 'https://www.instagram.com/rel1/' }],
      },
    ]);
    (BrightDataClient as any).mockImplementationOnce(function (this: any) {
      this.scrapeInstagramProfiles = scrape;
      return this;
    });

    (prisma.igCandidateProfile.create as any).mockResolvedValue({ id: 'c1' });

    const queueService = {
      addJob: vi.fn(async () => {
        throw new Error('redis');
      }),
    } as any;

    const svc = new IgGraphTraversalService(queueService);
    const out = await svc.runOneCycle(1);
    // Candidate was created; enqueue failed; still should not throw
    expect(out.seedsUsed).toBe(1);
  });
});

