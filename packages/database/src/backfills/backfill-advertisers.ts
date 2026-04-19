import { PrismaClient, Source } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const leads = await prisma.lead.findMany({
    where: { source: Source.FACEBOOK_ADS },
    select: { id: true, sourceHandle: true, companyName: true },
  });

  let processed = 0;
  let skippedNoPageId = 0;
  let linked = 0;
  let advertisersCreated = 0;
  let advertisersExisted = 0;

  for (const lead of leads) {
    processed++;
    const pageId = lead.sourceHandle?.trim();
    if (!pageId) {
      skippedNoPageId++;
      continue;
    }

    const existing = await prisma.advertiser.findUnique({
      where: { pageId },
      select: { id: true },
    });

    const advertiser = await prisma.advertiser.upsert({
      where: { pageId },
      create: {
        pageId,
        pageName: lead.companyName,
      },
      update: {
        pageName: lead.companyName,
      },
    });

    if (existing) {
      advertisersExisted++;
    } else {
      advertisersCreated++;
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: { advertiserId: advertiser.id },
    });
    linked++;
  }

  console.log(
    JSON.stringify(
      {
        processed,
        skippedNoPageId,
        linked,
        advertisersCreated,
        advertisersExisted,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    void prisma.$disconnect();
    process.exit(1);
  });
