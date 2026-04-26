import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { IgCoachQualifier } from './qualifier-ig';
import { QualifierError } from './qualifier';

function mkAnthropicWithText(text: string): Anthropic {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: 'text', text }],
      })),
    },
  } as any;
}

describe('IgCoachQualifier (2-stage)', () => {
  const baseInput = {
    username: 'testuser',
    fullName: 'Test User',
    category: null,
    followers: 1234,
    postsCount: 10,
    isVerified: false,
    isBusinessAccount: true,
    isPrivate: false,
    externalUrl: 'https://example.com',
    biography: 'Bio text',
  };

  it('Stage 1 qualified -> returns stage 1 result and does not fetch URL', async () => {
    const stage1 = JSON.stringify({
      decision: 'qualified',
      reason: 'Clear coach bio.',
      category: 'coach',
      confidence: 'high',
      inferredCountry: 'US',
      metadata: {
        person_name: 'Test',
        business_name: 'Test Coaching',
        niche: 'Health',
        sub_niche: null,
        offering_type: '1_on_1_coaching',
        specific_offering_mentioned: null,
        unique_angle_or_method: null,
        social_proof: null,
        tone_signals: null,
      },
    });
    const anthropic = mkAnthropicWithText(stage1);
    const fetchUrlContent = vi.fn(async () => 'ignored');

    const q = new IgCoachQualifier(anthropic, fetchUrlContent);
    const out = await q.qualify(baseInput);
    expect(out.stage).toBe(1);
    expect(out.qualified).toBe(true);
    expect(out.inferredCountry).toBe('US');
    expect(out.urlFetchAttempted).toBe(false);
    expect(out.urlFetchSucceeded).toBeNull();
    expect(fetchUrlContent).not.toHaveBeenCalled();
  });

  it('Stage 1 disqualified -> returns stage 1 result and does not fetch URL', async () => {
    const stage1 = JSON.stringify({
      decision: 'disqualified',
      reason: 'Private account.',
      category: 'other',
      confidence: 'high',
      inferredCountry: null,
      metadata: null,
    });
    const anthropic = mkAnthropicWithText(stage1);
    const fetchUrlContent = vi.fn(async () => 'ignored');

    const q = new IgCoachQualifier(anthropic, fetchUrlContent);
    const out = await q.qualify({ ...baseInput, isPrivate: true });
    expect(out.stage).toBe(1);
    expect(out.qualified).toBe(false);
    expect(out.inferredCountry).toBeNull();
    expect(out.urlFetchAttempted).toBe(false);
    expect(out.urlFetchSucceeded).toBeNull();
    expect(fetchUrlContent).not.toHaveBeenCalled();
  });

  it('Stage 1 unclear + Stage 2 qualified -> returns stage 2 result and fetches URL', async () => {
    const stage1 = JSON.stringify({
      decision: 'unclear',
      reason: 'Not enough signal.',
      category: null,
      confidence: 'low',
      inferredCountry: null,
      metadata: null,
    });
    const stage2 = JSON.stringify({
      qualified: true,
      reason: 'Program found on external URL.',
      category: 'course_creator',
      confidence: 'medium',
      inferredCountry: 'GB',
      metadata: {
        person_name: null,
        business_name: 'Example',
        niche: 'Menopause',
        sub_niche: null,
        offering_type: 'course',
        specific_offering_mentioned: 'Workshop',
        unique_angle_or_method: null,
        social_proof: null,
        tone_signals: null,
      },
    });

    const anthropic = {
      messages: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ content: [{ type: 'text', text: stage1 }] })
          .mockResolvedValueOnce({ content: [{ type: 'text', text: stage2 }] }),
      },
    } as any;

    const fetchUrlContent = vi.fn(async () => 'Some landing page content');
    const q = new IgCoachQualifier(anthropic, fetchUrlContent);
    const out = await q.qualify(baseInput);
    expect(out.stage).toBe(2);
    expect(out.qualified).toBe(true);
    expect(out.inferredCountry).toBe('GB');
    expect(out.urlFetchAttempted).toBe(true);
    expect(out.urlFetchSucceeded).toBe(true);
    expect(fetchUrlContent).toHaveBeenCalledTimes(1);
  });

  it('Stage 1 unclear + URL fetch fails -> Stage 2 still runs and urlFetchSucceeded=false', async () => {
    const stage1 = JSON.stringify({
      decision: 'unclear',
      reason: 'Unclear.',
      category: null,
      confidence: 'low',
      inferredCountry: null,
      metadata: null,
    });
    const stage2 = JSON.stringify({
      qualified: false,
      reason: 'Could not verify offer.',
      category: 'other',
      confidence: 'low',
      inferredCountry: null,
      metadata: null,
    });

    const anthropic = {
      messages: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ content: [{ type: 'text', text: stage1 }] })
          .mockResolvedValueOnce({ content: [{ type: 'text', text: stage2 }] }),
      },
    } as any;

    const fetchUrlContent = vi.fn(async () => {
      throw new Error('network');
    });
    const q = new IgCoachQualifier(anthropic, fetchUrlContent);
    const out = await q.qualify(baseInput);
    expect(out.stage).toBe(2);
    expect(out.inferredCountry).toBeNull();
    expect(out.urlFetchAttempted).toBe(true);
    expect(out.urlFetchSucceeded).toBe(false);
  });

  it('Stage 1 unclear + no external URL -> Stage 2 runs with urlFetchAttempted=false', async () => {
    const stage1 = JSON.stringify({
      decision: 'unclear',
      reason: 'Unclear.',
      category: null,
      confidence: 'low',
      inferredCountry: null,
      metadata: null,
    });
    const stage2 = JSON.stringify({
      qualified: false,
      reason: 'No external info.',
      category: 'other',
      confidence: 'low',
      inferredCountry: null,
      metadata: null,
    });

    const anthropic = {
      messages: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ content: [{ type: 'text', text: stage1 }] })
          .mockResolvedValueOnce({ content: [{ type: 'text', text: stage2 }] }),
      },
    } as any;

    const fetchUrlContent = vi.fn(async () => 'ignored');
    const q = new IgCoachQualifier(anthropic, fetchUrlContent);
    const out = await q.qualify({ ...baseInput, externalUrl: null });
    expect(out.stage).toBe(2);
    expect(out.inferredCountry).toBeNull();
    expect(out.urlFetchAttempted).toBe(false);
    expect(out.urlFetchSucceeded).toBeNull();
    expect(fetchUrlContent).not.toHaveBeenCalled();
  });

  it('Stage 1 parse failure -> throws QualifierError', async () => {
    const anthropic = mkAnthropicWithText('not json');
    const q = new IgCoachQualifier(anthropic, async () => null);
    await expect(q.qualify(baseInput)).rejects.toBeInstanceOf(QualifierError);
  });

  it('Stage 2 parse failure -> throws QualifierError', async () => {
    const stage1 = JSON.stringify({
      decision: 'unclear',
      reason: 'Unclear.',
      category: null,
      confidence: 'low',
      metadata: null,
    });
    const anthropic = {
      messages: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ content: [{ type: 'text', text: stage1 }] })
          .mockResolvedValueOnce({ content: [{ type: 'text', text: 'nope' }] }),
      },
    } as any;
    const q = new IgCoachQualifier(anthropic, async () => 'content');
    await expect(q.qualify(baseInput)).rejects.toBeInstanceOf(QualifierError);
  });
});

