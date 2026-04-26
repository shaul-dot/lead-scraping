import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IgEnrichProcessor } from './ig-enrich.processor';

vi.mock('@hyperscale/database', () => {
  return {
    prisma: {
      igCandidateProfile: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      knownAdvertiser: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    },
  };
});

vi.mock('@hyperscale/adapters/brightdata', () => {
  return {
    BrightDataClient: vi.fn().mockImplementation(() => ({
      scrapeInstagramProfiles: vi.fn(),
    })),
  };
});

vi.mock('@hyperscale/adapters/qualification/qualifier-ig', () => {
  return {
    IgCoachQualifier: vi.fn().mockImplementation(() => ({
      qualify: vi.fn(),
    })),
  };
});

import { prisma } from '@hyperscale/database';
import { BrightDataClient } from '@hyperscale/adapters/brightdata';
import { IgCoachQualifier } from '@hyperscale/adapters/qualification/qualifier-ig';

function mkJob(data: any) {
  return { id: 'job1', data } as any;
}

function mockBrightDataOnce(scrapeInstagramProfiles: any) {
  (BrightDataClient as any).mockImplementationOnce(function (this: any) {
    this.scrapeInstagramProfiles = scrapeInstagramProfiles;
    return this;
  });
}

function mockQualifierOnce(qualify: any) {
  (IgCoachQualifier as any).mockImplementationOnce(function (this: any) {
    this.qualify = qualify;
    return this;
  });
}

describe('IgEnrichProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRIGHT_DATA_API_TOKEN = 'x';
    process.env.ANTHROPIC_API_KEY = 'y';
    process.env.EXA_API_KEY = 'z';
  });

  it('Candidate not found -> returns early', async () => {
    (prisma.igCandidateProfile.findUnique as any).mockResolvedValue(null);
    const p = new IgEnrichProcessor();
    await p.process(mkJob({ candidateId: 'c1' }));
    expect(prisma.igCandidateProfile.update).not.toHaveBeenCalled();
  });

  it('Candidate already non-PENDING -> returns early', async () => {
    (prisma.igCandidateProfile.findUnique as any).mockResolvedValue({
      id: 'c1',
      instagramHandle: 'somehandle',
      status: 'ENRICHED',
    });
    const p = new IgEnrichProcessor();
    await p.process(mkJob({ candidateId: 'c1' }));
    expect(prisma.igCandidateProfile.update).not.toHaveBeenCalled();
  });

  it('Bright Data fetch fails -> marks ENRICHMENT_FAILED', async () => {
    (prisma.igCandidateProfile.findUnique as any).mockResolvedValue({
      id: 'c1',
      instagramHandle: 'somehandle',
      status: 'PENDING_ENRICHMENT',
      discoveryChannel: 'APIFY_FB_ADS',
    });

    mockBrightDataOnce(
      vi.fn(async () => {
        throw new Error('boom');
      }),
    );
    mockQualifierOnce(vi.fn());
    const p = new IgEnrichProcessor();

    await p.process(mkJob({ candidateId: 'c1' }));
    expect(prisma.igCandidateProfile.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'ENRICHMENT_FAILED' },
    });
  });

  it('Bright Data returns empty -> marks ENRICHMENT_FAILED', async () => {
    (prisma.igCandidateProfile.findUnique as any).mockResolvedValue({
      id: 'c1',
      instagramHandle: 'somehandle',
      status: 'PENDING_ENRICHMENT',
      discoveryChannel: 'APIFY_FB_ADS',
    });

    mockBrightDataOnce(vi.fn(async () => []));
    mockQualifierOnce(vi.fn());
    const p = new IgEnrichProcessor();

    await p.process(mkJob({ candidateId: 'c1' }));
    expect(prisma.igCandidateProfile.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'ENRICHMENT_FAILED' },
    });
  });

  it('IG handle matches existing KnownAdvertiser -> marks ALREADY_KNOWN, no qualify', async () => {
    (prisma.igCandidateProfile.findUnique as any).mockResolvedValue({
      id: 'c1',
      instagramHandle: 'somehandle',
      status: 'PENDING_ENRICHMENT',
      discoveryChannel: 'APIFY_FB_ADS',
    });

    const scrape = vi.fn(async () => [
      {
        account: 'somehandle',
        full_name: 'X',
        profile_name: 'X',
        followers: 1,
        posts_count: 1,
        is_verified: false,
        is_business_account: false,
        is_private: false,
        biography: 'bio',
        external_url: null,
        profile_url: 'https://www.instagram.com/somehandle/',
        business_category_name: null,
        category_name: null,
      },
    ]);
    mockBrightDataOnce(scrape);
    const qualify = vi.fn();
    mockQualifierOnce(qualify);
    (prisma.knownAdvertiser.findFirst as any).mockResolvedValueOnce({ id: 'k1' });

    const p = new IgEnrichProcessor();
    await p.process(mkJob({ candidateId: 'c1' }));

    expect(prisma.igCandidateProfile.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'ALREADY_KNOWN', enrichedAt: expect.any(Date) },
    });

    expect(qualify).not.toHaveBeenCalled();
  });

  it('Website domain matches existing KnownAdvertiser -> marks ALREADY_KNOWN, no qualify', async () => {
    (prisma.igCandidateProfile.findUnique as any).mockResolvedValue({
      id: 'c1',
      instagramHandle: 'somehandle',
      status: 'PENDING_ENRICHMENT',
      discoveryChannel: 'APIFY_FB_ADS',
    });
    const scrape = vi.fn(async () => [
      {
        account: 'somehandle',
        full_name: 'X',
        profile_name: 'X',
        followers: 1,
        posts_count: 1,
        is_verified: false,
        is_business_account: false,
        is_private: false,
        biography: 'bio',
        external_url: 'https://www.example.com/offer',
        profile_url: 'https://www.instagram.com/somehandle/',
        business_category_name: null,
        category_name: null,
      },
    ]);
    mockBrightDataOnce(scrape);
    mockQualifierOnce(vi.fn());
    (prisma.knownAdvertiser.findFirst as any)
      .mockResolvedValueOnce(null) // by handle
      .mockResolvedValueOnce({ id: 'k2' }); // by domain

    const p = new IgEnrichProcessor();
    await p.process(mkJob({ candidateId: 'c1' }));

    expect(prisma.igCandidateProfile.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'ALREADY_KNOWN', enrichedAt: expect.any(Date) },
    });
  });

  it('No match + qualifier returns qualified -> inserts KnownAdvertiser, marks ENRICHED', async () => {
    (prisma.igCandidateProfile.findUnique as any).mockResolvedValue({
      id: 'c1',
      instagramHandle: 'somehandle',
      status: 'PENDING_ENRICHMENT',
      discoveryChannel: 'APIFY_FB_ADS',
    });
    mockBrightDataOnce(
      vi.fn(async () => [
      {
        account: 'somehandle',
        full_name: 'Jane Doe',
        profile_name: 'Jane Coaching',
        followers: 1,
        posts_count: 1,
        is_verified: false,
        is_business_account: false,
        is_private: false,
        biography: 'bio',
        external_url: 'https://www.example.com/offer',
        profile_url: 'https://www.instagram.com/somehandle/',
        business_category_name: null,
        category_name: null,
      },
      ]),
    );
    (prisma.knownAdvertiser.findFirst as any).mockResolvedValue(null);

    const qualify = vi.fn(async () => ({
      qualified: true,
      reason: 'ok',
      category: 'coach',
      confidence: 'high',
      inferredCountry: 'US',
      metadata: { personName: 'Jane Doe', businessName: 'Jane Coaching' },
      stage: 2,
      urlFetchAttempted: true,
      urlFetchSucceeded: true,
    }));
    mockQualifierOnce(qualify);

    const p = new IgEnrichProcessor();
    await p.process(mkJob({ candidateId: 'c1' }));

    expect(prisma.knownAdvertiser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        instagramHandle: 'somehandle',
        aiQualificationReason: 'ok',
        aiQualificationCategory: 'coach',
        aiQualificationConfidence: 'high',
        aiQualificationStage: 2,
        aiUrlFetchAttempted: true,
        aiUrlFetchSucceeded: true,
        aiInferredCountry: 'US',
      }),
    });
    expect(prisma.igCandidateProfile.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'ENRICHED', enrichedAt: expect.any(Date) },
    });
  });

  it('No match + qualifier returns disqualified -> does not insert, marks ENRICHED', async () => {
    (prisma.igCandidateProfile.findUnique as any).mockResolvedValue({
      id: 'c1',
      instagramHandle: 'somehandle',
      status: 'PENDING_ENRICHMENT',
      discoveryChannel: 'APIFY_FB_ADS',
    });
    mockBrightDataOnce(
      vi.fn(async () => [
      {
        account: 'somehandle',
        full_name: 'Jane Doe',
        profile_name: 'Jane Coaching',
        followers: 1,
        posts_count: 1,
        is_verified: false,
        is_business_account: false,
        is_private: false,
        biography: 'bio',
        external_url: null,
        profile_url: 'https://www.instagram.com/somehandle/',
        business_category_name: null,
        category_name: null,
      },
      ]),
    );
    (prisma.knownAdvertiser.findFirst as any).mockResolvedValue(null);

    const qualify = vi.fn(async () => ({
      qualified: false,
      reason: 'no',
      category: 'other',
      confidence: 'high',
      inferredCountry: null,
      metadata: null,
      stage: 1,
      urlFetchAttempted: false,
      urlFetchSucceeded: null,
    }));
    mockQualifierOnce(qualify);

    const p = new IgEnrichProcessor();
    await p.process(mkJob({ candidateId: 'c1' }));
    expect(prisma.knownAdvertiser.create).not.toHaveBeenCalled();
    expect(prisma.igCandidateProfile.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'ENRICHED', enrichedAt: expect.any(Date) },
    });
  });

  it('Qualifier throws -> marks ENRICHMENT_FAILED', async () => {
    (prisma.igCandidateProfile.findUnique as any).mockResolvedValue({
      id: 'c1',
      instagramHandle: 'somehandle',
      status: 'PENDING_ENRICHMENT',
      discoveryChannel: 'APIFY_FB_ADS',
    });
    mockBrightDataOnce(
      vi.fn(async () => [
      {
        account: 'somehandle',
        full_name: 'Jane Doe',
        profile_name: 'Jane Coaching',
        followers: 1,
        posts_count: 1,
        is_verified: false,
        is_business_account: false,
        is_private: false,
        biography: 'bio',
        external_url: null,
        profile_url: 'https://www.instagram.com/somehandle/',
        business_category_name: null,
        category_name: null,
      },
      ]),
    );
    (prisma.knownAdvertiser.findFirst as any).mockResolvedValue(null);

    const qualify = vi.fn(async () => {
      throw new Error('boom');
    });
    mockQualifierOnce(qualify);

    const p = new IgEnrichProcessor();
    await p.process(mkJob({ candidateId: 'c1' }));
    expect(prisma.igCandidateProfile.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'ENRICHMENT_FAILED' },
    });
  });

  it('Insert race condition -> warns but still marks ENRICHED', async () => {
    (prisma.igCandidateProfile.findUnique as any).mockResolvedValue({
      id: 'c1',
      instagramHandle: 'somehandle',
      status: 'PENDING_ENRICHMENT',
      discoveryChannel: 'APIFY_FB_ADS',
    });
    mockBrightDataOnce(
      vi.fn(async () => [
      {
        account: 'somehandle',
        full_name: 'Jane Doe',
        profile_name: 'Jane Coaching',
        followers: 1,
        posts_count: 1,
        is_verified: false,
        is_business_account: false,
        is_private: false,
        biography: 'bio',
        external_url: null,
        profile_url: 'https://www.instagram.com/somehandle/',
        business_category_name: null,
        category_name: null,
      },
      ]),
    );
    (prisma.knownAdvertiser.findFirst as any).mockResolvedValue(null);

    const qualify = vi.fn(async () => ({
      qualified: true,
      reason: 'ok',
      category: 'coach',
      confidence: 'high',
      inferredCountry: null,
      metadata: { personName: 'Jane Doe', businessName: 'Jane Coaching' },
      stage: 1,
      urlFetchAttempted: false,
      urlFetchSucceeded: null,
    }));
    mockQualifierOnce(qualify);

    (prisma.knownAdvertiser.create as any).mockRejectedValue(new Error('Unique constraint'));

    const p = new IgEnrichProcessor();
    await p.process(mkJob({ candidateId: 'c1' }));
    expect(prisma.igCandidateProfile.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'ENRICHED', enrichedAt: expect.any(Date) },
    });
  });

  it('Qualified + inferredCountry outside allowlist -> DQ, no KnownAdvertiser, candidate marked ENRICHED', async () => {
    (prisma.igCandidateProfile.findUnique as any).mockResolvedValue({
      id: 'c1',
      instagramHandle: 'somehandle',
      status: 'PENDING_ENRICHMENT',
      discoveryChannel: 'APIFY_FB_ADS',
    });

    mockBrightDataOnce(
      vi.fn(async () => [
        {
          account: 'somehandle',
          full_name: 'Jane Doe',
          profile_name: 'Jane Coaching',
          followers: 1,
          posts_count: 1,
          is_verified: false,
          is_business_account: false,
          is_private: false,
          biography: 'bio',
          external_url: 'https://www.example.com/offer',
          profile_url: 'https://www.instagram.com/somehandle/',
          business_category_name: null,
          category_name: null,
        },
      ]),
    );
    (prisma.knownAdvertiser.findFirst as any).mockResolvedValue(null);

    const qualify = vi.fn(async () => ({
      qualified: true,
      reason: 'ok',
      category: 'coach',
      confidence: 'high',
      inferredCountry: 'IN',
      metadata: { personName: 'Jane Doe', businessName: 'Jane Coaching' },
      stage: 2,
      urlFetchAttempted: true,
      urlFetchSucceeded: true,
    }));
    mockQualifierOnce(qualify);

    const p = new IgEnrichProcessor();
    await p.process(mkJob({ candidateId: 'c1' }));

    expect(prisma.knownAdvertiser.create).not.toHaveBeenCalled();
    expect(prisma.igCandidateProfile.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'ENRICHED', enrichedAt: expect.any(Date) },
    });
  });

  it('Qualified + inferredCountry null -> permissive, inserts KnownAdvertiser with aiInferredCountry=null', async () => {
    (prisma.igCandidateProfile.findUnique as any).mockResolvedValue({
      id: 'c1',
      instagramHandle: 'somehandle',
      status: 'PENDING_ENRICHMENT',
      discoveryChannel: 'APIFY_FB_ADS',
    });

    mockBrightDataOnce(
      vi.fn(async () => [
        {
          account: 'somehandle',
          full_name: 'Jane Doe',
          profile_name: 'Jane Coaching',
          followers: 1,
          posts_count: 1,
          is_verified: false,
          is_business_account: false,
          is_private: false,
          biography: 'bio',
          external_url: 'https://www.example.com/offer',
          profile_url: 'https://www.instagram.com/somehandle/',
          business_category_name: null,
          category_name: null,
        },
      ]),
    );
    (prisma.knownAdvertiser.findFirst as any).mockResolvedValue(null);

    const qualify = vi.fn(async () => ({
      qualified: true,
      reason: 'ok',
      category: 'coach',
      confidence: 'high',
      inferredCountry: null,
      metadata: { personName: 'Jane Doe', businessName: 'Jane Coaching' },
      stage: 2,
      urlFetchAttempted: true,
      urlFetchSucceeded: true,
    }));
    mockQualifierOnce(qualify);

    const p = new IgEnrichProcessor();
    await p.process(mkJob({ candidateId: 'c1' }));

    expect(prisma.knownAdvertiser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        aiInferredCountry: null,
      }),
    });
  });
});

