import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import type { Keyword } from '@hyperscale/database';

export type SearchEntry = {
  query: string;
  sourceKeyword: string;
  componentKeywordIds: string[];
  patternType: 'identity' | 'niche_funnel' | 'transformation_funnel' | 'audience_funnel' | 'sweep';
};

type DbClient = typeof prisma;

const WEIGHTS = {
  identity: 0.4,
  niche_funnel: 0.4,
  trans_or_audience_funnel: 0.1,
  sweep: 0.1,
} as const;

function pickWeightedType(r: number): keyof typeof WEIGHTS {
  // r in [0,1)
  let acc = 0;
  for (const [k, w] of Object.entries(WEIGHTS) as Array<[keyof typeof WEIGHTS, number]>) {
    acc += w;
    if (r < acc) return k;
  }
  return 'sweep';
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function orderOldestFirst() {
  return {
    lastUsedAt: { sort: 'asc' as const, nulls: 'first' as const },
  };
}

async function fetchOldestEnabled(
  db: DbClient,
  patternHint: string,
  take: number,
): Promise<Keyword[]> {
  return db.keyword.findMany({
    where: { enabled: true, patternHint },
    orderBy: [orderOldestFirst()],
    take,
  });
}

async function fetchOldestEnabledNonIdentity(db: DbClient, take: number): Promise<Keyword[]> {
  return db.keyword.findMany({
    where: { enabled: true, NOT: { patternHint: 'identity' } },
    orderBy: [orderOldestFirst()],
    take,
  });
}

@Injectable()
export class KeywordCombinatorService {
  // In-memory toggle to lightly alternate trans vs audience across batches.
  private nextComboPref: 'transformation' | 'audience' = 'transformation';

  private readonly db: DbClient;

  constructor() {
    this.db = prisma;
  }

  async pickNextSearchBatch(n: number): Promise<SearchEntry[]> {
    if (!Number.isFinite(n) || n <= 0) return [];

    // Decide desired types via proportional sampling.
    const slots: Array<keyof typeof WEIGHTS> = [];
    for (let i = 0; i < n; i++) slots.push(pickWeightedType(Math.random()));

    const wantIdentity = slots.filter((s) => s === 'identity').length;
    const wantNicheFunnel = slots.filter((s) => s === 'niche_funnel').length;
    const wantTransOrAud = slots.filter((s) => s === 'trans_or_audience_funnel').length;
    const wantSweep = slots.filter((s) => s === 'sweep').length;

    // Pull small "oldest-first" pools (rotation preference) then random-pick within each.
    const [identityPool, nichePool, funnelPool, transPool, audiencePool, sweepPool] =
      await Promise.all([
        fetchOldestEnabled(this.db, 'identity', Math.max(1, wantIdentity) * 3),
        fetchOldestEnabled(this.db, 'niche', 30),
        fetchOldestEnabled(this.db, 'funnel', 30),
        fetchOldestEnabled(this.db, 'transformation', 30),
        fetchOldestEnabled(this.db, 'audience', 30),
        fetchOldestEnabledNonIdentity(this.db, 30),
      ]);

    const entries: SearchEntry[] = [];
    const usedIds: string[] = [];

    for (const slot of slots) {
      if (slot === 'identity') {
        if (identityPool.length === 0) continue;
        const k = randomPick(identityPool);
        const query = k.primary;
        entries.push({
          query,
          sourceKeyword: query,
          componentKeywordIds: [k.id],
          patternType: 'identity',
        });
        usedIds.push(k.id);
        continue;
      }

      if (slot === 'niche_funnel') {
        if (nichePool.length === 0 || funnelPool.length === 0) continue;
        const niche = randomPick(nichePool);
        const funnel = randomPick(funnelPool);
        const query = `${niche.primary} ${funnel.primary}`;
        entries.push({
          query,
          sourceKeyword: query,
          componentKeywordIds: [niche.id, funnel.id],
          patternType: 'niche_funnel',
        });
        usedIds.push(niche.id, funnel.id);
        continue;
      }

      if (slot === 'trans_or_audience_funnel') {
        if (funnelPool.length === 0) continue;

        const choose = Math.random() < 0.5 ? 'transformation' : 'audience';
        const preferred = this.nextComboPref;
        const pickType = Math.random() < 0.6 ? preferred : choose;

        const leftPool = pickType === 'transformation' ? transPool : audiencePool;
        if (leftPool.length === 0) continue;

        const left = randomPick(leftPool);
        const funnel = randomPick(funnelPool);
        const query = `${left.primary} ${funnel.primary}`;
        entries.push({
          query,
          sourceKeyword: query,
          componentKeywordIds: [left.id, funnel.id],
          patternType: pickType === 'transformation' ? 'transformation_funnel' : 'audience_funnel',
        });
        usedIds.push(left.id, funnel.id);
        continue;
      }

      // sweep
      if (sweepPool.length === 0) continue;
      const k = randomPick(sweepPool);
      const query = k.primary;
      entries.push({
        query,
        sourceKeyword: query,
        componentKeywordIds: [k.id],
        patternType: 'sweep',
      });
      usedIds.push(k.id);
    }

    // If we were unable to satisfy all slots (empty pools), top up with sweeps.
    while (entries.length < n && sweepPool.length > 0) {
      const k = randomPick(sweepPool);
      const query = k.primary;
      entries.push({
        query,
        sourceKeyword: query,
        componentKeywordIds: [k.id],
        patternType: 'sweep',
      });
      usedIds.push(k.id);
    }

    const uniqueIds = [...new Set(usedIds)];
    if (uniqueIds.length > 0) {
      await this.db.keyword.updateMany({
        where: { id: { in: uniqueIds } },
        data: { lastUsedAt: new Date() },
      });
    }

    // Alternate preference next cycle.
    this.nextComboPref = this.nextComboPref === 'transformation' ? 'audience' : 'transformation';

    // Ensure non-empty queries and correct length.
    return entries
      .filter((e) => e.query.trim().length > 0)
      .slice(0, n);
  }
}

