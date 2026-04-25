// Dev helper — manually enqueues a Facebook scrape job for local testing only.
// Usage: pnpm exec tsx apps/api/scripts/enqueue-scrape-facebook.mts "keyword" 10
/**
 * Enqueue a BullMQ `scrape-facebook` job (local smoke / debugging).
 * From repo root (load .env into process first), then e.g.:
 *   cd apps/api && pnpm exec tsx scripts/enqueue-scrape-facebook.mts "life coach" 10
 */
import { Queue } from 'bullmq';

const keyword = process.argv[2] ?? 'business coach';

function parsePositiveInt(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

const maxResults = parsePositiveInt(process.argv[3], 10);
if (maxResults < 10) {
  console.warn(
    `[warn] maxResults=${maxResults} requested. Apify actor enforces a minimum of 10, so this will effectively run with 10.`,
  );
}

const connection = process.env.REDIS_URL
  ? { url: process.env.REDIS_URL }
  : {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD ?? undefined,
    };

const queue = new Queue('scrape-facebook', { connection });
const job = await queue.add('scrape-facebook', { keyword, maxResults });
console.log(JSON.stringify({ queue: 'scrape-facebook', jobId: job.id, keyword, maxResults }, null, 2));
await queue.close();
