import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

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

function tokenPreview(token: string): string {
  const t = token.trim();
  if (t.length <= 12) return `${t.slice(0, 4)}…${t.slice(-2)}`;
  return `${t.slice(0, 8)}…${t.slice(-4)}`;
}

function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') out[key] = '[redacted]';
    else out[key] = value;
  });
  return out;
}

function truncateBody(text: string, maxBytes = 4096): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.byteLength <= maxBytes) return { text, truncated: false };
  return { text: buf.subarray(0, maxBytes).toString('utf8') + '\n…(truncated)…', truncated: true };
}

async function getTokenWithSource(): Promise<{ token: string; source: 'vault' | 'env' }> {
  const sessionsMod = (await import('@hyperscale/sessions')) as any;
  const getServiceApiKey = sessionsMod.getServiceApiKey ?? sessionsMod.default?.getServiceApiKey;
  if (!getServiceApiKey) throw new Error('Failed to load getServiceApiKey from @hyperscale/sessions');

  const fromVault = await getServiceApiKey('apify');
  if (fromVault && String(fromVault).trim()) return { token: String(fromVault), source: 'vault' };

  const fromEnv = process.env.APIFY_TOKEN ?? '';
  if (fromEnv.trim()) return { token: fromEnv, source: 'env' };

  throw new Error('No Apify token found in vault or APIFY_TOKEN env var');
}

async function reportVaultRowPresence(): Promise<void> {
  const dbMod = (await import('@hyperscale/database')) as any;
  const prisma: any = dbMod.prisma ?? dbMod.default?.prisma;
  if (!prisma) throw new Error('Failed to load prisma client from @hyperscale/database');

  const row = await prisma.sessionCredential.findFirst({
    where: { service: 'apify', account: 'api_key' },
    select: { id: true, status: true, failureCount: true, lastUsedAt: true, lastHealthCheckAt: true, lastReauthAt: true },
  });

  console.log('=== VAULT ROW (apify/api_key) ===');
  console.log(
    JSON.stringify(
      row
        ? {
            present: true,
            id: row.id,
            status: row.status,
            failureCount: row.failureCount,
            lastUsedAt: row.lastUsedAt,
            lastHealthCheckAt: row.lastHealthCheckAt,
            lastReauthAt: row.lastReauthAt,
          }
        : { present: false },
      null,
      2,
    ),
  );
}

async function restCall(token: string): Promise<void> {
  console.log('=== DIRECT REST CALL ===');
  const url =
    'https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/run-sync-get-dataset-items';

  const body = {
    hashtags: ['webscraping'],
    resultsLimit: 5,
    resultsType: 'posts',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  const clipped = truncateBody(text, 4096);

  console.log(JSON.stringify({ status: res.status, ok: res.ok }, null, 2));
  console.log('--- headers ---');
  console.log(JSON.stringify(redactHeaders(res.headers), null, 2));
  console.log('--- body (up to 4KB) ---');
  console.log(clipped.text);

  if (!res.ok) {
    try {
      const parsed = JSON.parse(text) as any;
      const errType = parsed?.error?.type;
      const errMsg = parsed?.error?.message;
      console.log('--- parsed error ---');
      console.log(JSON.stringify({ 'error.type': errType, 'error.message': errMsg }, null, 2));
    } catch {
      // ignore parse errors
    }
  }
}

async function sdkCall(token: string): Promise<void> {
  console.log('=== SDK CALL (apify-client) ===');

  const require = createRequire(import.meta.url);
  const { ApifyClient } = require(
    require.resolve('apify-client', {
      paths: [path.resolve(process.cwd(), '..', '..', 'packages', 'adapters')],
    }),
  ) as typeof import('apify-client');

  const client = new ApifyClient({ token });

  try {
    const run = await client.actor('apify/instagram-hashtag-scraper').call({
      hashtags: ['webscraping'],
      resultsLimit: 5,
      resultsType: 'posts',
    });

    const datasetId = (run as any)?.defaultDatasetId as string | undefined;
    const runId = (run as any)?.id as string | undefined;

    if (!datasetId) {
      console.log(JSON.stringify({ ok: false, reason: 'missing defaultDatasetId', runId }, null, 2));
      return;
    }

    const { items } = await client.dataset(datasetId).listItems();
    console.log(
      JSON.stringify(
        { ok: true, runId, datasetId, itemsReturned: Array.isArray(items) ? items.length : null },
        null,
        2,
      ),
    );
  } catch (e: any) {
    console.log(JSON.stringify({ ok: false, errorName: e?.name, errorMessage: e?.message }, null, 2));
    console.log('--- full error ---');
    console.log(e?.stack ? String(e.stack) : String(e));
  }
}

async function main(): Promise<void> {
  loadDotEnvIfPresent();

  console.log('=== apify-client version ===');
  console.log('See `packages/adapters/package.json` dependency (should be 2.23.0).');

  await reportVaultRowPresence();

  const { token, source } = await getTokenWithSource();
  console.log('=== TOKEN SOURCE ===');
  console.log(JSON.stringify({ source, preview: tokenPreview(token) }, null, 2));

  await restCall(token);
  await sdkCall(token);
}

await main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

