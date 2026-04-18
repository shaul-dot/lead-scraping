/**
 * One-off: list dataset items for an Apify run (vault token).
 * Usage: pnpm --filter @hyperscale/scraper exec tsx ../scripts/fetch-apify-run-items.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApifyClient } from 'apify-client';
import { getServiceApiKey } from '../packages/sessions/src/index.ts';

const RUN_ID = 'lOyg17PjT3gDtx3wM';

function loadEnvFile(path: string) {
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

async function main() {
  loadEnvFile(resolve(process.cwd(), '.env'));
  const token = await getServiceApiKey('apify');
  if (!token) throw new Error('No apify token from vault');

  const client = new ApifyClient({ token });
  const run = await client.run(RUN_ID).get();
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 100 });

  function pickStr(o: Record<string, unknown>, ...keys: string[]): string {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return '';
  }

  const rows = items.map((it, idx) => {
    const o = it as Record<string, unknown>;
    const snap = typeof o.snapshot === 'object' && o.snapshot ? (o.snapshot as Record<string, unknown>) : null;
    let snapText = '';
    if (snap) {
      const body = snap.body;
      if (body && typeof body === 'object' && 'texts' in body) {
        const texts = (body as { texts?: unknown }).texts;
        if (Array.isArray(texts)) snapText = texts.filter((t) => typeof t === 'string').join(' ');
      }
    }
    const snapshotBlob =
      snap && Object.keys(snap).length > 0 ? JSON.stringify(snap) : '';

    const adText =
      pickStr(o, 'adText', 'ad_text', 'body') ||
      snapText ||
      snapshotBlob;

    return {
      index: idx + 1,
      pageName: pickStr(o, 'pageName', 'page_name'),
      linkUrl: pickStr(o, 'linkUrl', 'link_url', 'ad_library_url', 'url'),
      adTextFirst300: adText.slice(0, 300),
      pageId: pickStr(o, 'pageId', 'page_id', 'pageID'),
      startDate: o.startDate ?? o.start_date ?? o.startDateFormatted,
      endDate: o.endDate ?? o.end_date ?? o.endDateFormatted,
    };
  });

  const firstKeys = items[0] ? Object.keys(items[0] as object).sort() : [];

  console.log(
    JSON.stringify(
      {
        runId: run.id,
        datasetId: run.defaultDatasetId,
        itemCount: items.length,
        firstItemKeys: firstKeys,
        items: rows,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
