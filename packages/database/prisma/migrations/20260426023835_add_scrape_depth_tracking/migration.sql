-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "consecutiveZeroYieldRuns" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "firstScrapedAt" TIMESTAMP(3),
ADD COLUMN     "lastScrapedAt" TIMESTAMP(3),
ADD COLUMN     "totalAdsScraped" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalNewAdvertisers" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ScrapeQueryStats" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "firstScrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalAdsScraped" INTEGER NOT NULL DEFAULT 0,
    "totalNewAdvertisers" INTEGER NOT NULL DEFAULT 0,
    "consecutiveZeroYieldRuns" INTEGER NOT NULL DEFAULT 0,
    "isStale" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ScrapeQueryStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScrapeQueryStats_query_key" ON "ScrapeQueryStats"("query");

-- CreateIndex
CREATE INDEX "ScrapeQueryStats_query_idx" ON "ScrapeQueryStats"("query");

-- CreateIndex
CREATE INDEX "ScrapeQueryStats_lastScrapedAt_idx" ON "ScrapeQueryStats"("lastScrapedAt");

-- CreateIndex
CREATE INDEX "ScrapeQueryStats_isStale_idx" ON "ScrapeQueryStats"("isStale");
