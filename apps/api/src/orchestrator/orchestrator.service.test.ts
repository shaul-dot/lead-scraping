import { describe, expect, it, vi, beforeEach } from 'vitest';
import { OrchestratorService } from './orchestrator.service';

function mkOrchestrator(opts?: {
  c2?: any;
  c3?: any;
  c4?: any;
}) {
  const igGoogleNicheService = opts?.c2 ?? { runOneCycle: vi.fn() };
  const igGoogleFunnelService = opts?.c3 ?? { runOneCycle: vi.fn() };
  const igGoogleAggregatorService = opts?.c4 ?? { runOneCycle: vi.fn() };

  // Other deps are irrelevant for IG cycle unit tests
  const queue = {} as any;
  const budget = {} as any;
  const source = {} as any;
  const keyword = {} as any;
  const combinator = {} as any;
  const dns = {} as any;
  const blacklist = {} as any;
  const reputation = {} as any;
  const rotation = {} as any;
  const remediation = {} as any;

  const svc = new OrchestratorService(
    queue,
    budget,
    source,
    keyword,
    combinator,
    dns,
    blacklist,
    reputation,
    rotation,
    remediation,
    igGoogleNicheService,
    igGoogleFunnelService,
    igGoogleAggregatorService,
  );

  return { svc, igGoogleNicheService, igGoogleFunnelService, igGoogleAggregatorService };
}

describe('OrchestratorService.runIgPipelineCycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.IG_PIPELINE_ENABLED = 'true';
    delete process.env.IG_CHANNEL_2_KEYWORDS_PER_CYCLE;
    delete process.env.IG_CHANNEL_3_COMBINATIONS_PER_CYCLE;
    delete process.env.IG_CHANNEL_4_KEYWORDS_PER_CYCLE;
  });

  it('happy path: calls all 3 channels with defaults and returns combined result', async () => {
    const c2 = { runOneCycle: vi.fn(async () => ({ keywordsUsed: 3, candidatesEnqueued: 10, candidatesSkippedDuplicates: 2 })) };
    const c3 = { runOneCycle: vi.fn(async () => ({ combinationsUsed: 3, candidatesEnqueued: 5, candidatesSkippedDuplicates: 1 })) };
    const c4 = {
      runOneCycle: vi.fn(async () => ({
        keywordsUsed: 2,
        totalQueries: 8,
        totalResultsReturned: 123,
        candidatesEnqueued: 7,
        candidatesSkippedDuplicates: 0,
        handlesExtractedNone: 4,
      })),
    };
    const { svc } = mkOrchestrator({ c2, c3, c4 });

    const out = await svc.runIgPipelineCycle();
    expect(c2.runOneCycle).toHaveBeenCalledWith(3);
    expect(c3.runOneCycle).toHaveBeenCalledWith(3);
    expect(c4.runOneCycle).toHaveBeenCalledWith(2);

    expect(out).toEqual({
      channel2: { keywordsUsed: 3, candidatesEnqueued: 10, candidatesSkippedDuplicates: 2 },
      channel3: { combinationsUsed: 3, candidatesEnqueued: 5, candidatesSkippedDuplicates: 1 },
      channel4: {
        keywordsUsed: 2,
        candidatesEnqueued: 7,
        candidatesSkippedDuplicates: 0,
        handlesExtractedNone: 4,
      },
    });
  });

  it('IG_PIPELINE_ENABLED=false -> returns zeros and does not call channels', async () => {
    process.env.IG_PIPELINE_ENABLED = 'false';
    const c2 = { runOneCycle: vi.fn() };
    const c3 = { runOneCycle: vi.fn() };
    const c4 = { runOneCycle: vi.fn() };
    const { svc } = mkOrchestrator({ c2, c3, c4 });

    const out = await svc.runIgPipelineCycle();
    expect(c2.runOneCycle).not.toHaveBeenCalled();
    expect(c3.runOneCycle).not.toHaveBeenCalled();
    expect(c4.runOneCycle).not.toHaveBeenCalled();
    expect(out.channel2.keywordsUsed).toBe(0);
    expect(out.channel3.combinationsUsed).toBe(0);
    expect(out.channel4.keywordsUsed).toBe(0);
  });

  it('one channel throws -> others still awaited via allSettled', async () => {
    process.env.IG_CHANNEL_2_KEYWORDS_PER_CYCLE = '4';
    process.env.IG_CHANNEL_3_COMBINATIONS_PER_CYCLE = '5';
    process.env.IG_CHANNEL_4_KEYWORDS_PER_CYCLE = '6';

    const c2 = { runOneCycle: vi.fn(async () => { throw new Error('c2 down'); }) };
    const c3 = { runOneCycle: vi.fn(async () => ({ combinationsUsed: 5, candidatesEnqueued: 1, candidatesSkippedDuplicates: 0 })) };
    const c4 = {
      runOneCycle: vi.fn(async () => ({
        keywordsUsed: 6,
        totalQueries: 24,
        totalResultsReturned: 10,
        candidatesEnqueued: 2,
        candidatesSkippedDuplicates: 0,
        handlesExtractedNone: 8,
      })),
    };
    const { svc } = mkOrchestrator({ c2, c3, c4 });

    const out = await svc.runIgPipelineCycle();
    expect(c2.runOneCycle).toHaveBeenCalledWith(4);
    expect(c3.runOneCycle).toHaveBeenCalledWith(5);
    expect(c4.runOneCycle).toHaveBeenCalledWith(6);

    expect(out.channel2).toEqual({ keywordsUsed: 0, candidatesEnqueued: 0, candidatesSkippedDuplicates: 0 });
    expect(out.channel3.combinationsUsed).toBe(5);
    expect(out.channel4.keywordsUsed).toBe(6);
  });
});

