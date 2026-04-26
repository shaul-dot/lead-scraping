-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN     "lastTraversedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "KnownAdvertiser_instagramHandle_lastTraversedAt_idx" ON "KnownAdvertiser"("instagramHandle", "lastTraversedAt");
