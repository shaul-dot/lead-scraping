-- CreateEnum
CREATE TYPE "EmailSource" AS ENUM ('BIO_TEXT', 'SITE_SCRAPE', 'LINKTREE_RESOLVE', 'GOOGLE_SERP', 'SNOV', 'GUESS', 'APIFY_IG_SCRAPER', 'APOLLO', 'BUSINESS_EMAIL');

-- CreateEnum
CREATE TYPE "EmailType" AS ENUM ('GENERIC', 'PERSONAL', 'ROLE', 'UNKNOWN');

-- AlterEnum: replace EnrichmentStatus values; map existing rows explicitly (NEEDS_ENRICHMENT -> PENDING, etc.)
BEGIN;
CREATE TYPE "EnrichmentStatus_new" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'NO_EMAIL_FOUND');
ALTER TABLE "KnownAdvertiser" ALTER COLUMN "enrichmentStatus" DROP DEFAULT;
ALTER TABLE "KnownAdvertiser" ALTER COLUMN "enrichmentStatus" TYPE "EnrichmentStatus_new" USING (
  CASE "enrichmentStatus"::text
    WHEN 'NEEDS_ENRICHMENT' THEN 'PENDING'::"EnrichmentStatus_new"
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'::"EnrichmentStatus_new"
    WHEN 'ENRICHED' THEN 'COMPLETED'::"EnrichmentStatus_new"
    WHEN 'CONTACTED' THEN 'COMPLETED'::"EnrichmentStatus_new"
    WHEN 'REPLIED' THEN 'COMPLETED'::"EnrichmentStatus_new"
    WHEN 'DEAD' THEN 'FAILED'::"EnrichmentStatus_new"
    ELSE 'PENDING'::"EnrichmentStatus_new"
  END
);
ALTER TYPE "EnrichmentStatus" RENAME TO "EnrichmentStatus_old";
ALTER TYPE "EnrichmentStatus_new" RENAME TO "EnrichmentStatus";
DROP TYPE "EnrichmentStatus_old";
ALTER TABLE "KnownAdvertiser" ALTER COLUMN "enrichmentStatus" SET DEFAULT 'PENDING'::"EnrichmentStatus";
COMMIT;

-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN "enrichmentAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "enrichmentCompletedAt" TIMESTAMP(3),
ADD COLUMN "enrichmentLastError" TEXT,
ADD COLUMN "enrichmentStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LeadEmail" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "source" "EmailSource" NOT NULL,
    "sourceDetail" TEXT,
    "emailType" "EmailType" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadEmail_leadId_idx" ON "LeadEmail"("leadId");

-- CreateIndex
CREATE INDEX "LeadEmail_address_idx" ON "LeadEmail"("address");

-- CreateIndex
CREATE UNIQUE INDEX "LeadEmail_leadId_address_key" ON "LeadEmail"("leadId", "address");

-- AddForeignKey
ALTER TABLE "LeadEmail" ADD CONSTRAINT "LeadEmail_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "KnownAdvertiser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
