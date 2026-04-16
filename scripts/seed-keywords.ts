#!/usr/bin/env tsx
/**
 * Seed the Keyword table with initial keywords per source.
 *
 * Usage: pnpm tsx scripts/seed-keywords.ts
 */

import { prisma, Source } from '@hyperscale/database';

interface KeywordEntry {
  primary: string;
  source: Source;
}

const FACEBOOK_ADS_KEYWORDS: KeywordEntry[] = [
  { primary: 'coaching webinar', source: 'FACEBOOK_ADS' as Source },
  { primary: 'consulting masterclass', source: 'FACEBOOK_ADS' as Source },
  { primary: 'course creator training', source: 'FACEBOOK_ADS' as Source },
  { primary: 'online coaching program', source: 'FACEBOOK_ADS' as Source },
  { primary: 'business coaching free training', source: 'FACEBOOK_ADS' as Source },
  { primary: 'health coach workshop', source: 'FACEBOOK_ADS' as Source },
  { primary: 'life coaching bootcamp', source: 'FACEBOOK_ADS' as Source },
  { primary: 'fitness coaching challenge', source: 'FACEBOOK_ADS' as Source },
  { primary: 'coaching certification', source: 'FACEBOOK_ADS' as Source },
  { primary: 'digital course launch', source: 'FACEBOOK_ADS' as Source },
];

const INSTAGRAM_KEYWORDS: KeywordEntry[] = [
  { primary: 'coaching', source: 'INSTAGRAM' as Source },
  { primary: 'businesscoach', source: 'INSTAGRAM' as Source },
  { primary: 'lifecoach', source: 'INSTAGRAM' as Source },
  { primary: 'onlinecoach', source: 'INSTAGRAM' as Source },
  { primary: 'coachingprogram', source: 'INSTAGRAM' as Source },
  { primary: 'courselaunch', source: 'INSTAGRAM' as Source },
  { primary: 'consultingbusiness', source: 'INSTAGRAM' as Source },
  { primary: 'healthcoach', source: 'INSTAGRAM' as Source },
  { primary: 'fitnesscoach', source: 'INSTAGRAM' as Source },
  { primary: 'mindsetcoach', source: 'INSTAGRAM' as Source },
];

const ALL_KEYWORDS = [
  ...FACEBOOK_ADS_KEYWORDS,
  ...INSTAGRAM_KEYWORDS,
];

async function main() {
  console.log('Seeding keywords...\n');

  let created = 0;
  let skipped = 0;

  for (const kw of ALL_KEYWORDS) {
    const existing = await prisma.keyword.findFirst({
      where: { primary: kw.primary, source: kw.source },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.keyword.create({ data: kw });
    created++;
  }

  console.log(`  Created: ${created}`);
  console.log(`  Skipped (already exist): ${skipped}`);
  console.log(`  Total keywords in DB: ${await prisma.keyword.count()}`);
  console.log('\nKeyword seeding complete.');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('Keyword seeding failed:', e);
    prisma.$disconnect();
    process.exit(1);
  });
