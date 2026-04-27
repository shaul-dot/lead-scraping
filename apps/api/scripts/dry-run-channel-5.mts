import { Queue } from 'bullmq';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

type Args = {
  hashtagsOverride: string[] | null;
  postsPerHashtag: number;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { hashtagsOverride: null, postsPerHashtag: 20, dryRun: false };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;

    if (a === '--dry-run') {
      out.dryRun = true;
      continue;
    }

    if (a.startsWith('--posts=')) {
      const raw = a.slice('--posts='.length).trim();
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && Number.isInteger(n) && n > 0) out.postsPerHashtag = n;
      continue;
    }

    // PowerShell treats commas as array separators, so `--hashtags=a,b,c` can arrive as:
    // ["--hashtags=a", "b", "c"]
    if (a.startsWith('--hashtags=')) {
      const first = a.slice('--hashtags='.length).trim();
      const collected: string[] = [];
      if (first) collected.push(first);

      while (i + 1 < argv.length) {
        const next = argv[i + 1]!;
        if (next.startsWith('--')) break;
        collected.push(next);
        i++;
      }

      const tags = collected
        .join(' ')
        .split(/[,\s]+/g)
        .map((t) => t.trim().replace(/^#+/, '').toLowerCase())
        .filter(Boolean);

      out.hashtagsOverride = tags.length > 0 ? tags : [];
      continue;
    }
  }

  return out;
}

function connectionFromEnv(): { url: string } | { host: string; port: number; password?: string } {
  if (process.env.REDIS_URL) return { url: process.env.REDIS_URL };
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? undefined,
  };
}

function loadDotEnvIfPresent(): void {
  const envPath = path.resolve(process.cwd(), '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if (!key) continue;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

async function getApifyTokenOrThrow(): Promise<string> {
  const sessionsMod = (await import('@hyperscale/sessions')) as any;
  const getServiceApiKey =
    sessionsMod.getServiceApiKey ?? sessionsMod.default?.getServiceApiKey;
  if (!getServiceApiKey) {
    throw new Error('Failed to load getServiceApiKey from @hyperscale/sessions');
  }

  const fromVault = await getServiceApiKey('apify');
  const token = fromVault ?? process.env.APIFY_TOKEN ?? '';
  if (!token) {
    throw new Error(
      'APIFY_TOKEN missing (and no apify key in vault). Set $env:APIFY_TOKEN in this session.',
    );
  }
  return token;
}

async function fetchFirstRawApifyItem(hashtag: string, postsPerHashtag: number): Promise<unknown | null> {
  const token = await getApifyTokenOrThrow();
  const require = createRequire(import.meta.url);
  const { ApifyClient } = require(
    require.resolve('apify-client', {
      paths: [path.resolve(process.cwd(), '..', '..', 'packages', 'adapters')],
    }),
  ) as typeof import('apify-client');
  const client = new ApifyClient({ token });

  const run = await client.actor('apify/instagram-hashtag-scraper').call({
    hashtags: [hashtag],
    resultsLimit: postsPerHashtag,
    resultsType: 'posts',
  });

  const datasetId = (run as any)?.defaultDatasetId as string | undefined;
  if (!datasetId) return null;

  const { items } = await client.dataset(datasetId).listItems();
  return items?.[0] ?? null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  loadDotEnvIfPresent();

  const dbMod = (await import('@hyperscale/database')) as any;
  const prisma: any = dbMod.prisma ?? dbMod.default?.prisma;
  if (!prisma) {
    throw new Error('Failed to load prisma client from @hyperscale/database');
  }

  const adaptersMod = (await import('@hyperscale/adapters')) as any;
  const ApifyInstagramHashtagScraper =
    adaptersMod.ApifyInstagramHashtagScraper ?? adaptersMod.default?.ApifyInstagramHashtagScraper;
  if (!ApifyInstagramHashtagScraper) {
    throw new Error('Failed to load ApifyInstagramHashtagScraper from @hyperscale/adapters');
  }

  const normalizeMod = (await import('@hyperscale/adapters/utils/normalize-platform-handles')) as any;
  const normalizeInstagramHandle =
    normalizeMod.normalizeInstagramHandle ?? normalizeMod.default?.normalizeInstagramHandle;
  if (!normalizeInstagramHandle) {
    throw new Error('Failed to load normalizeInstagramHandle from adapters');
  }

  const picked =
    args.hashtagsOverride !== null
      ? await prisma.hashtag.findMany({
          where: { enabled: true, hashtag: { in: args.hashtagsOverride } },
          orderBy: [{ lastUsedAt: 'asc' }],
          select: { id: true, hashtag: true, category: true, lastUsedAt: true },
        })
      : await prisma.hashtag.findMany({
          where: { enabled: true },
          orderBy: [{ lastUsedAt: 'asc' }],
          take: 3,
          select: { id: true, hashtag: true, category: true, lastUsedAt: true },
        });

  const resolvedHashtags = picked.map((p) => p.hashtag);

  console.log('=== CHANNEL 5 DRY RUN ===');
  console.log(
    JSON.stringify(
      {
        dryRun: args.dryRun,
        postsPerHashtag: args.postsPerHashtag,
        hashtags: picked.map((p) => ({
          hashtag: p.hashtag,
          category: p.category,
          lastUsedAt: p.lastUsedAt,
        })),
      },
      null,
      2,
    ),
  );

  if (resolvedHashtags.length === 0) {
    console.log('No hashtags resolved. Exiting.');
    return;
  }

  const scraper = new ApifyInstagramHashtagScraper();
  const result = await scraper.scrapeHashtags({
    hashtags: resolvedHashtags,
    postsPerHashtag: args.postsPerHashtag,
  });

  console.log('=== SCRAPE SUMMARY ===');
  console.log(
    JSON.stringify(
      {
        hashtagsAttempted: result.hashtagsAttempted,
        hashtagsWithResults: result.hashtagsWithResults,
        totalPostsReturned: result.posts.length,
      },
      null,
      2,
    ),
  );

  const perHashtag = new Map<string, { count: number; sample: string[] }>();
  for (const h of resolvedHashtags) perHashtag.set(h, { count: 0, sample: [] });
  for (const p of result.posts) {
    const bucket = perHashtag.get(p.hashtag) ?? { count: 0, sample: [] };
    bucket.count++;
    if (bucket.sample.length < 3) bucket.sample.push(p.ownerUsername);
    perHashtag.set(p.hashtag, bucket);
  }

  console.log('=== PER-HASHTAG BREAKDOWN ===');
  console.log(
    JSON.stringify(
      Object.fromEntries([...perHashtag.entries()].map(([k, v]) => [k, v])),
      null,
      2,
    ),
  );

  console.log('=== FIRST RAW APIFY POST OBJECT (for schema inspection) ===');
  try {
    const firstRaw = await fetchFirstRawApifyItem(resolvedHashtags[0]!, args.postsPerHashtag);
    console.log(JSON.stringify(firstRaw, null, 2));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[warn] Failed to fetch raw Apify post object:', message);
  }

  const uniqueHandles = new Map<
    string,
    { discoveredViaHashtag: string; postUrl?: string; caption?: string }
  >();

  for (const p of result.posts) {
    const handle = normalizeInstagramHandle(p.ownerUsername);
    if (!handle) continue;
    if (!uniqueHandles.has(handle)) {
      uniqueHandles.set(handle, {
        discoveredViaHashtag: p.hashtag,
        postUrl: p.postUrl,
        caption: p.caption,
      });
    }
  }

  console.log('=== HANDLE EXTRACTION ===');
  console.log(JSON.stringify({ uniqueHandles: uniqueHandles.size }, null, 2));

  let alreadyCandidate = 0;
  let alreadyKnown = 0;
  let fresh = 0;

  const handleList = [...uniqueHandles.keys()];

  for (const h of handleList) {
    const [cand, known] = await Promise.all([
      prisma.igCandidateProfile.findUnique({
        where: { instagramHandle: h },
        select: { id: true },
      }),
      prisma.knownAdvertiser.findFirst({
        where: { instagramHandle: h },
        select: { id: true },
      }),
    ]);

    if (cand) alreadyCandidate++;
    else if (known) alreadyKnown++;
    else fresh++;
  }

  console.log('=== DEDUP BREAKDOWN ===');
  console.log(
    JSON.stringify(
      {
        totalUniqueHandles: handleList.length,
        new: fresh,
        alreadyInIgCandidateProfile: alreadyCandidate,
        alreadyInKnownAdvertiser: alreadyKnown,
      },
      null,
      2,
    ),
  );

  if (args.dryRun) {
    console.log('DRY RUN: skipping inserts and enqueues');
    console.log('=== SUMMARY ===');
    console.log(
      JSON.stringify(
        {
          hashtags: resolvedHashtags,
          postsScraped: result.posts.length,
          uniqueHandles: handleList.length,
          newCandidates: 'DRY RUN',
          enrichmentJobsQueued: 'DRY RUN',
        },
        null,
        2,
      ),
    );
    return;
  }

  const hashtagCategory = new Map(picked.map((p) => [p.hashtag, p.category ?? null]));

  const queue = new Queue('enrich-ig-candidate', { connection: connectionFromEnv() });
  let inserted = 0;
  let skipped = 0;
  let enqueueErrors = 0;
  let jobsQueued = 0;

  for (const handle of handleList) {
    const meta = uniqueHandles.get(handle)!;
    try {
      const existing = await prisma.igCandidateProfile.findUnique({
        where: { instagramHandle: handle },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }

      const candidate = await prisma.igCandidateProfile.create({
        data: {
          instagramHandle: handle,
          sourceUrl: meta.postUrl ?? null,
          discoveryChannel: 'APIFY_HASHTAG_NICHE',
          sourceMetadata: {
            discoveredViaHashtag: meta.discoveredViaHashtag,
            hashtagCategory: hashtagCategory.get(meta.discoveredViaHashtag) ?? null,
            postCaption: meta.caption ? meta.caption.slice(0, 500) : null,
          },
          status: 'PENDING_ENRICHMENT',
        },
        select: { id: true },
      });

      inserted++;
      try {
        await queue.add('enrich-ig-candidate', { candidateId: candidate.id });
        jobsQueued++;
      } catch (e) {
        enqueueErrors++;
        const message = e instanceof Error ? e.message : String(e);
        console.warn('[warn] Failed to enqueue enrich job:', message);
      }
    } catch (e: any) {
      if (e?.code === 'P2002' || String(e?.message ?? '').includes('Unique constraint')) {
        skipped++;
      } else {
        enqueueErrors++;
        const message = e instanceof Error ? e.message : String(e);
        console.warn('[warn] Insert failed:', message);
      }
    }
  }

  await queue.close();

  console.log('=== FINAL COUNTS ===');
  console.log(
    JSON.stringify(
      { inserted, skippedAlreadyExisted: skipped, enqueueErrors, enrichmentJobsQueued: jobsQueued },
      null,
      2,
    ),
  );

  console.log('=== SUMMARY ===');
  console.log(
    JSON.stringify(
      {
        hashtags: resolvedHashtags,
        postsScraped: result.posts.length,
        uniqueHandles: handleList.length,
        newCandidates: inserted,
        enrichmentJobsQueued: jobsQueued,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

