-- CreateEnum
CREATE TYPE "EnrichmentStatus" AS ENUM ('NEEDS_ENRICHMENT', 'IN_PROGRESS', 'ENRICHED', 'CONTACTED', 'REPLIED', 'DEAD');

-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN     "email2" TEXT,
ADD COLUMN     "employeeCount" TEXT,
ADD COLUMN     "enrichmentNotes" TEXT,
ADD COLUMN     "enrichmentStatus" "EnrichmentStatus" NOT NULL DEFAULT 'NEEDS_ENRICHMENT',
ADD COLUMN     "landingPageUrl" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "socialMedia" TEXT,
ADD COLUMN     "title" TEXT;

-- CreateIndex
CREATE INDEX "KnownAdvertiser_enrichmentStatus_idx" ON "KnownAdvertiser"("enrichmentStatus");
