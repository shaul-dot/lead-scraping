import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import * as dbMod from '@hyperscale/database';
import * as normalizeDomainMod from '../../../packages/adapters/src/utils/normalize-domain';
const { detectAndNormalizeSocialMedia } = (await import(
  '../../../packages/adapters/src/utils/normalize-platform-handles.ts'
)) as any;

const normalizeDomain: (url: string | null | undefined) => string | null =
  (normalizeDomainMod as any).normalizeDomain ??
  (normalizeDomainMod as any).default?.normalizeDomain;

const prisma: any = (dbMod as any).prisma ?? (dbMod as any).default?.prisma;
if (!prisma) {
  throw new Error('Failed to load prisma client from @hyperscale/database');
}

const FILE = process.argv[2] ?? '../../MASTERLIST _ Lead Gen - Leads.csv';
const BATCH_SIZE = 1000;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function parseDateMaybe(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

const raw = fs.readFileSync(FILE, 'utf8');
const records = parse(raw, {
  columns: true,
  skip_empty_lines: true,
  relax_quotes: true,
  relax_column_count: true,
  bom: true,
});

const rows = Array.isArray(records) ? (records as Array<Record<string, unknown>>) : [];
console.log('File:', FILE);
console.log('Total CSV rows:', rows.length);

let processed = 0;
let skippedNoDomain = 0;
let inserted = 0;
let dbErrors = 0;

let batch: any[] = [];

async function flush(): Promise<void> {
  if (batch.length === 0) return;
  try {
    const res = await prisma.knownAdvertiser.createMany({
      data: batch,
      skipDuplicates: true,
    });
    inserted += res.count;
  } catch (e) {
    dbErrors++;
    console.error('createMany failed:', e);
  } finally {
    batch = [];
  }
}

for (const r of rows) {
  processed++;

  const websiteUrlOriginal = str(r['Website Link']);
  const websiteDomain = normalizeDomain(websiteUrlOriginal);
  if (!websiteDomain) {
    skippedNoDomain++;
    continue;
  }

  const data = {
    companyName: str(r['Company']) || null,
    fullName: str(r['Full Name']) || null,
    firstName: str(r['First N.']) || null,
    websiteDomain,
    websiteUrlOriginal: websiteUrlOriginal || null,
    email: str(r['Email #1']) || null,
    email2: str(r['Email #2']) || null,
    phone: str(r['Phone #']) || null,
    title: str(r['Title']) || null,
    socialMedia: str(r['Socia Media']) || str(r['Socials']) || null,
    employeeCount: str(r['Emp. #']) || null,
    landingPageUrl: str(r['Landing Page']) || null,
    country: str(r['Country']) || null,
    addedBy: str(r['Added By']) || null,
    addedDate: parseDateMaybe(r['Date']),
    leadSource: str(r['Socials']) || str(r['Socia Media']) || null,
  };

  const socialMediaValue = (data as any).socialMedia;
  const detected = detectAndNormalizeSocialMedia(socialMediaValue);
  (data as any).instagramHandle = detected.platform === 'instagram' ? detected.handle : null;
  (data as any).linkedinHandle = detected.platform === 'linkedin' ? detected.handle : null;
  (data as any).skoolHandle = detected.platform === 'skool' ? detected.handle : null;

  batch.push(data);
  if (batch.length >= BATCH_SIZE) {
    await flush();
    if (processed % 10000 === 0) {
      console.log(
        JSON.stringify(
          { processed, inserted, skippedNoDomain, dbErrors, inFlightBatch: batch.length },
          null,
          2,
        ),
      );
    }
  }
}

await flush();

console.log('Import complete.');
console.log(
  JSON.stringify(
    {
      totalCsvRows: rows.length,
      processed,
      inserted,
      skippedNoDomain,
      dbErrors,
    },
    null,
    2,
  ),
);

