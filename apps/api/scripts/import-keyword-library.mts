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

function pickArgValue(flag: string): string | null {
  const idx = process.argv.findIndex((a) => a === flag);
  if (idx === -1) return null;
  const val = process.argv[idx + 1];
  return val ? val : null;
}

const defaultCsvPath = 'C:\\Users\\shaul\\Code\\lead-scraping\\keyword_library_v2.csv';
const csvPath = pickArgValue('--csv') ?? process.env.CSV_PATH ?? defaultCsvPath;

type CsvRow = {
  category?: string;
  sub_category?: string;
  keyword?: string;
  pattern_hint?: string;
  source?: string;
  notes?: string;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  const abs = path.resolve(csvPath);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `CSV file not found at ${abs}. Provide via --csv <path> or set CSV_PATH.`,
    );
  }

  const raw = fs.readFileSync(abs, 'utf8');
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as CsvRow[];

  const totalRows = records.length;

  const data = records
    .map((r, i) => {
      const keyword = r.keyword?.trim();
      if (!keyword) return { kind: 'skip' as const, reason: `row ${i + 2} missing keyword` };

      return {
        kind: 'ok' as const,
        row: {
          primary: keyword,
          secondary: null,
          source: 'FACEBOOK_ADS' as const,
          enabled: true,
          category: r.category?.trim() || null,
          subCategory: r.sub_category?.trim() || null,
          patternHint: r.pattern_hint?.trim() || null,
          notes: r.notes?.trim() || null,
        },
      };
    })
    .filter((x) => x.kind === 'ok')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((x: any) => x.row);

  let inserted = 0;
  let skipped = totalRows - data.length;
  let errors = 0;

  for (const batch of chunk(data, 500)) {
    try {
      const res = await prisma.keyword.createMany({
        data: batch,
        skipDuplicates: true,
      });
      inserted += res.count;
      skipped += batch.length - res.count;
    } catch (e) {
      errors += batch.length;
      console.error('Batch insert failed:', e);
    }
  }

  console.log(
    JSON.stringify(
      { csvPath: abs, totalCsvRows: totalRows, inserted, skipped, errors },
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

