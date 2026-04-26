import { describe, expect, it } from 'vitest';
import { KeywordCombinatorService } from './keyword-combinator.service';

function makeKeyword(id: string, primary: string, patternHint: string, lastUsedAt: Date | null = null) {
  return {
    id,
    primary,
    secondary: null,
    source: 'FACEBOOK_ADS',
    enabled: true,
    labels: [],
    lastUsedAt,
    totalYield: 0,
    icpPassRate: 0,
    bookingYield: 0,
    score: 1,
    discoveredBy: 'manual',
    discoveredAt: new Date(),
    leads: [],
    category: null,
    subCategory: null,
    patternHint,
    notes: null,
  } as any;
}

function makeDb() {
  const keywords = {
    identity: Array.from({ length: 120 }, (_, i) => makeKeyword(`id_${i}`, `identity_${i}`, 'identity')),
    niche: Array.from({ length: 120 }, (_, i) => makeKeyword(`n_${i}`, `niche_${i}`, 'niche')),
    funnel: Array.from({ length: 120 }, (_, i) => makeKeyword(`f_${i}`, `funnel_${i}`, 'funnel')),
    transformation: Array.from({ length: 120 }, (_, i) =>
      makeKeyword(`t_${i}`, `transformation_${i}`, 'transformation'),
    ),
    audience: Array.from({ length: 120 }, (_, i) => makeKeyword(`a_${i}`, `audience_${i}`, 'audience')),
  };

  const all = [
    ...keywords.identity,
    ...keywords.niche,
    ...keywords.funnel,
    ...keywords.transformation,
    ...keywords.audience,
  ];

  const updatedIds: string[] = [];

  const db = {
    keyword: {
      findMany: async (args: any) => {
        const hint = args?.where?.patternHint;
        const notIdentity = args?.where?.NOT?.patternHint === 'identity';

        let rows = all;
        if (hint) rows = all.filter((k) => k.patternHint === hint);
        if (notIdentity) rows = all.filter((k) => k.patternHint !== 'identity');

        // Simulate "oldest first, nulls first" by leaving ordering deterministic.
        return rows.slice(0, args.take ?? rows.length);
      },
      updateMany: async (args: any) => {
        const ids: string[] = args.where.id.in;
        updatedIds.push(...ids);
        return { count: ids.length };
      },
    },
  };

  return { db: db as any, updatedIds };
}

describe('KeywordCombinatorService', () => {
  it('pickNextSearchBatch(5) returns 5 non-empty entries', async () => {
    const { db } = makeDb();
    const svc = new KeywordCombinatorService();
    (svc as any).db = db;
    const out = await svc.pickNextSearchBatch(5);
    expect(out).toHaveLength(5);
    for (const e of out) {
      expect(typeof e.query).toBe('string');
      expect(e.query.trim().length).toBeGreaterThan(0);
      expect(e.sourceKeyword).toBe(e.query);
      expect(Array.isArray(e.componentKeywordIds)).toBe(true);
      expect(e.componentKeywordIds.length).toBeGreaterThan(0);
    }
  });

  it('updates lastUsedAt for component keyword ids', async () => {
    const { db, updatedIds } = makeDb();
    const svc = new KeywordCombinatorService();
    (svc as any).db = db;
    const out = await svc.pickNextSearchBatch(10);
    const expectedIds = new Set(out.flatMap((e) => e.componentKeywordIds));
    for (const id of expectedIds) {
      expect(updatedIds).toContain(id);
    }
  });

  it('patternType distribution is roughly weighted over many picks', async () => {
    const { db } = makeDb();
    const svc = new KeywordCombinatorService();
    (svc as any).db = db;

    const counts: Record<string, number> = {
      identity: 0,
      niche_funnel: 0,
      transformation_funnel: 0,
      audience_funnel: 0,
      sweep: 0,
    };

    for (let i = 0; i < 100; i++) {
      const batch = await svc.pickNextSearchBatch(10);
      for (const e of batch) counts[e.patternType] += 1;
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const pct = (x: number) => (x / total) * 100;

    // identity ~40%, niche_funnel ~40%, (trans+aud) ~10%, sweep ~10%
    expect(pct(counts.identity)).toBeGreaterThan(30);
    expect(pct(counts.identity)).toBeLessThan(50);

    expect(pct(counts.niche_funnel)).toBeGreaterThan(30);
    expect(pct(counts.niche_funnel)).toBeLessThan(50);

    expect(pct(counts.transformation_funnel + counts.audience_funnel)).toBeGreaterThan(5);
    expect(pct(counts.transformation_funnel + counts.audience_funnel)).toBeLessThan(20);

    expect(pct(counts.sweep)).toBeGreaterThan(5);
    expect(pct(counts.sweep)).toBeLessThan(20);
  });
});

