import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { CoachQualifier, QualifierError } from './qualifier';

describe('CoachQualifier', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('returns qualified output with mapped metadata', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            qualified: true,
            reason: 'Sells a coaching program online.',
            category: 'coach',
            confidence: 'high',
            metadata: {
              person_name: 'Jane Doe',
              business_name: 'Acme Coaching',
              niche: 'executive leadership',
              sub_niche: null,
              offering_type: 'group_program',
              specific_offering_mentioned: '12-week mastermind',
              unique_angle_or_method: null,
              social_proof: '500+ clients',
              tone_signals: 'direct',
            },
          }),
        },
      ],
    });

    const q = new CoachQualifier({ anthropicApiKey: 'test-key' });
    const out = await q.qualify({
      pageName: 'Jane Doe | Coach',
      adCopy: 'Scale your team.',
      landingPageContent: 'Join our mastermind.',
    });

    expect(out.qualified).toBe(true);
    expect(out.metadata).toEqual({
      personName: 'Jane Doe',
      businessName: 'Acme Coaching',
      niche: 'executive leadership',
      subNiche: null,
      offeringType: 'group_program',
      specificOffering: '12-week mastermind',
      uniqueAngle: null,
      socialProof: '500+ clients',
      toneSignals: 'direct',
    });
  });

  it('returns unqualified with null metadata', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            qualified: false,
            reason: 'Primary product is a SaaS app.',
            category: 'saas_app',
            confidence: 'high',
            metadata: { person_name: 'ignored' },
          }),
        },
      ],
    });

    const q = new CoachQualifier({ anthropicApiKey: 'test-key' });
    const out = await q.qualify({
      pageName: 'Some SaaS',
      adCopy: 'Download our app.',
      landingPageContent: null,
    });

    expect(out.qualified).toBe(false);
    expect(out.metadata).toBeNull();
  });

  it('throws QualifierError on non-JSON', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'not json at all' }],
    });

    const q = new CoachQualifier({ anthropicApiKey: 'test-key' });
    await expect(
      q.qualify({ pageName: 'x', adCopy: 'y', landingPageContent: null }),
    ).rejects.toSatisfy((e: unknown) => e instanceof QualifierError && e.rawAnthropicResponse === 'not json at all');
  });

  it('throws QualifierError when qualified is missing', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ reason: 'only reason', category: 'other', confidence: 'low' }),
        },
      ],
    });

    const q = new CoachQualifier({ anthropicApiKey: 'test-key' });
    await expect(
      q.qualify({ pageName: 'x', adCopy: 'y', landingPageContent: null }),
    ).rejects.toMatchObject({
      name: 'QualifierError',
      message: 'Qualifier JSON missing required field "qualified"',
    });
  });
});
