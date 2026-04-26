import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'csv-parse/sync';

const require = createRequire(import.meta.url);
const { PrismaClient } = require(
  require.resolve('@prisma/client', {
    paths: [path.join(process.cwd(), 'packages', 'database')],
  }),
) as typeof import('@prisma/client');

const prisma = new PrismaClient({ log: ['error'] });

const defaultCsvPath = 'C:\\Users\\shaul\\Code\\lead-scraping\\hashtag_library_v1.csv';
const csvPath = process.argv[2] ?? defaultCsvPath;

type CsvRow = {
  hashtag?: string;
  category?: string;
  tier?: string;
  notes?: string;
};

function normalizeHashtag(raw: string): { ok: true; value: string } | { ok: false; reason: string } {
  const stripped = raw.trim().replace(/^#+/, '');
  const lowered = stripped.toLowerCase();
  if (!lowered) return { ok: false, reason: 'skip: empty' };
  if (!/^[a-z0-9_]+$/.test(lowered)) return { ok: false, reason: `skip: invalid chars: ${raw}` };
  return { ok: true, value: lowered };
}

async function main(): Promise<void> {
  const abs = path.resolve(csvPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`CSV file not found at ${abs}. Pass a path as the first arg.`);
  }

  const raw = fs.readFileSync(abs, 'utf8');
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as CsvRow[];

  const seen = new Set<string>();
  const data: Array<{
    hashtag: string;
    category: string | null;
    tier: number | null;
    notes: string | null;
    enabled: true;
  }> = [];

  const skipCounts = {
    empty: 0,
    invalid: 0,
    dup: 0,
  };
  let tierWarnings = 0;

  for (const r of records) {
    const rawHashtag = (r.hashtag ?? '').toString();
    const normalized = normalizeHashtag(rawHashtag);
    if (!normalized.ok) {
      if (normalized.reason === 'skip: empty') skipCounts.empty++;
      else skipCounts.invalid++;
      console.log(normalized.reason);
      continue;
    }

    if (seen.has(normalized.value)) {
      skipCounts.dup++;
      console.log(`skip: dup: ${rawHashtag}`);
      continue;
    }
    seen.add(normalized.value);

    const category = r.category?.trim() ? r.category.trim() : null;
    const notes = r.notes?.trim() ? r.notes.trim() : null;

    let tier: number | null = null;
    const tierRaw = r.tier?.trim();
    if (tierRaw) {
      const n = parseInt(tierRaw, 10);
      if (Number.isFinite(n)) tier = n;
      else {
        tierWarnings++;
        console.warn(`warn: tier not parseable: ${tierRaw} (hashtag=${normalized.value})`);
      }
    }

    data.push({
      hashtag: normalized.value,
      category,
      tier,
      notes,
      enabled: true,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.hashtag.deleteMany({});
    await tx.hashtag.createMany({ data, skipDuplicates: true });
  });

  console.log(
    JSON.stringify(
      {
        csvPath: abs,
        totalCsvRowsRead: records.length,
        validRowsPrepared: data.length,
        imported: data.length, // after deleteMany, should match prepared barring unexpected dup constraints
        skipped: {
          empty: skipCounts.empty,
          invalid: skipCounts.invalid,
          dup: skipCounts.dup,
        },
        tierWarnings,
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

