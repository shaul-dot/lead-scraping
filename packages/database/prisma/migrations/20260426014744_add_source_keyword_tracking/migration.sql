-- AlterTable
ALTER TABLE "Advertiser" ADD COLUMN     "sourceKeyword" TEXT;

-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN     "sourceKeyword" TEXT;

-- CreateIndex
CREATE INDEX "Advertiser_sourceKeyword_idx" ON "Advertiser"("sourceKeyword");

-- CreateIndex
CREATE INDEX "KnownAdvertiser_sourceKeyword_idx" ON "KnownAdvertiser"("sourceKeyword");
