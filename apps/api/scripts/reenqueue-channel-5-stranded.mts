import fs from 'node:fs';
import path from 'node:path';
import { Queue } from 'bullmq';

type RedisConnection =
  | { url: string }
  | { host: string; port: number; password?: string };

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

function connectionFromExplicitRedisPublicUrl(): RedisConnection {
  const url = process.env.REDIS_PUBLIC_URL?.trim();
  if (!url) {
    throw new Error(
      'REDIS_PUBLIC_URL is required for this script run (must point to Railway public Redis).',
    );
  }
  return { url };
}

async function main(): Promise<void> {
  loadDotEnvIfPresent();

  const connection = connectionFromExplicitRedisPublicUrl();

  const dbMod = (await import('@hyperscale/database')) as any;
  const prisma = dbMod.prisma ?? dbMod.default?.prisma;
  if (!prisma) throw new Error('Failed to load prisma from @hyperscale/database');

  const rows: Array<{ id: string }> = await prisma.$queryRawUnsafe(`
    SELECT id
    FROM "IgCandidateProfile"
    WHERE "discoveryChannel" = 'APIFY_HASHTAG_NICHE'
      AND status = 'PENDING_ENRICHMENT'
      AND "createdAt" >= '2026-04-27T02:00:00Z'
    ORDER BY "createdAt" ASC;
  `);

  const queue = new Queue('enrich-ig-candidate', { connection });

  let jobsEnqueued = 0;
  let errors = 0;

  for (const r of rows) {
    try {
      await queue.add('enrich-ig-candidate', { candidateId: r.id });
      jobsEnqueued++;
    } catch {
      errors++;
    }
  }

  console.log(
    JSON.stringify(
      {
        rowsFound: rows.length,
        jobsEnqueued,
        errors,
        queue: 'enrich-ig-candidate',
      },
      null,
      2,
    ),
  );

  await queue.close();
  await prisma.$disconnect?.();
}

await main();

