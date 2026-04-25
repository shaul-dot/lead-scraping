import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import * as normalizeDomainMod from '../../../packages/adapters/src/utils/normalize-domain';

const normalizeDomain: (url: string | null | undefined) => string | null =
  (normalizeDomainMod as any).normalizeDomain ??
  (normalizeDomainMod as any).default?.normalizeDomain;

const FILE =
  process.argv[2] ?? '../../MASTERLIST _ Lead Gen - Leads.csv';

const raw = fs.readFileSync(FILE, 'utf8');
const records = parse(raw, {
  columns: true,
  skip_empty_lines: true,
  relax_quotes: true,
  relax_column_count: true,
  bom: true,
});

const rows = Array.isArray(records) ? records : [];
const rowCount = rows.length;
const headerKeys = rowCount > 0 ? Object.keys(rows[0]) : [];

console.log('File:', FILE);
console.log('Total rows:', rowCount);
console.log('Column count:', headerKeys.length);
console.log('Columns:', JSON.stringify(headerKeys, null, 2));

console.log('First 5 rows (including header via keys):');
console.log(JSON.stringify(rows.slice(0, 5), null, 2));

const websiteKeyCandidates = ['Website Link', 'Website', 'WebsiteLink', 'website', 'website_link'];
const websiteKey = websiteKeyCandidates.find((k) => headerKeys.includes(k));
if (!websiteKey) {
  console.log('No "Website Link" column found. Candidates checked:', websiteKeyCandidates);
  process.exit(0);
}

let nonEmptyWebsite = 0;
let validDomain = 0;

for (const r of rows) {
  const v = (r as any)[websiteKey];
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) continue;
  nonEmptyWebsite++;
  if (normalizeDomain(s)) validDomain++;
}

console.log(`Rows with non-empty "${websiteKey}":`, nonEmptyWebsite);
console.log('Rows with valid normalized domain:', validDomain);

