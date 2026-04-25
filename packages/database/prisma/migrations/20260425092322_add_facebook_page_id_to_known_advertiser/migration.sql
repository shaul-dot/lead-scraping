-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN     "facebookPageId" TEXT,
ALTER COLUMN "websiteDomain" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "KnownAdvertiser_facebookPageId_idx" ON "KnownAdvertiser"("facebookPageId");
