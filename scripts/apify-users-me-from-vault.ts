/**
 * One-off: GET https://api.apify.com/v2/users/me using vault Apify token.
 * Run from repo root: pnpm dlx tsx scripts/apify-users-me-from-vault.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getServiceApiKey } from '../packages/sessions/src/index.ts';

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
  if (!token) {
    console.error(JSON.stringify({ error: 'No apify token from vault (getServiceApiKey returned null)' }));
    process.exit(1);
  }

  const url = `https://api.apify.com/v2/users/me?token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const body = await res.text();
  console.log(body);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
