-- CreateEnum
CREATE TYPE "DiscoveryChannel" AS ENUM ('APIFY_FB_ADS', 'BRIGHTDATA_GRAPH_TRAVERSAL', 'BRIGHTDATA_GOOGLE_NICHE', 'BRIGHTDATA_GOOGLE_FUNNEL', 'BRIGHTDATA_GOOGLE_AGGREGATOR', 'APIFY_HASHTAG_NICHE', 'APIFY_HASHTAG_BEHAVIOR');

-- CreateEnum
CREATE TYPE "IgCandidateStatus" AS ENUM ('PENDING_ENRICHMENT', 'ENRICHED', 'ALREADY_KNOWN', 'ENRICHMENT_FAILED');

-- AlterTable
ALTER TABLE "Advertiser" ADD COLUMN     "discoveryChannel" "DiscoveryChannel",
ADD COLUMN     "instagramHandle" TEXT,
ADD COLUMN     "linkedinHandle" TEXT,
ADD COLUMN     "skoolHandle" TEXT;

-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN     "discoveryChannel" "DiscoveryChannel",
ADD COLUMN     "instagramHandle" TEXT,
ADD COLUMN     "linkedinHandle" TEXT,
ADD COLUMN     "skoolHandle" TEXT;

-- CreateTable
CREATE TABLE "IgCandidateProfile" (
    "id" TEXT NOT NULL,
    "instagramHandle" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "discoveryChannel" "DiscoveryChannel" NOT NULL,
    "sourceMetadata" JSONB,
    "status" "IgCandidateStatus" NOT NULL DEFAULT 'PENDING_ENRICHMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enrichedAt" TIMESTAMP(3),

    CONSTRAINT "IgCandidateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IgCandidateProfile_instagramHandle_key" ON "IgCandidateProfile"("instagramHandle");

-- CreateIndex
CREATE INDEX "IgCandidateProfile_status_idx" ON "IgCandidateProfile"("status");

-- CreateIndex
CREATE INDEX "IgCandidateProfile_discoveryChannel_idx" ON "IgCandidateProfile"("discoveryChannel");

-- CreateIndex
CREATE INDEX "IgCandidateProfile_createdAt_idx" ON "IgCandidateProfile"("createdAt");

-- CreateIndex
CREATE INDEX "Advertiser_instagramHandle_idx" ON "Advertiser"("instagramHandle");

-- CreateIndex
CREATE INDEX "Advertiser_linkedinHandle_idx" ON "Advertiser"("linkedinHandle");

-- CreateIndex
CREATE INDEX "Advertiser_skoolHandle_idx" ON "Advertiser"("skoolHandle");

-- CreateIndex
CREATE INDEX "KnownAdvertiser_instagramHandle_idx" ON "KnownAdvertiser"("instagramHandle");

-- CreateIndex
CREATE INDEX "KnownAdvertiser_linkedinHandle_idx" ON "KnownAdvertiser"("linkedinHandle");

-- CreateIndex
CREATE INDEX "KnownAdvertiser_skoolHandle_idx" ON "KnownAdvertiser"("skoolHandle");

-- CreateIndex
CREATE INDEX "KnownAdvertiser_discoveryChannel_idx" ON "KnownAdvertiser"("discoveryChannel");
