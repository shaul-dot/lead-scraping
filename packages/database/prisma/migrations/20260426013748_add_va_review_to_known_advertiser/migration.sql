-- CreateEnum
CREATE TYPE "VaReviewStatus" AS ENUM ('UNREVIEWED', 'IS_ICP', 'NOT_ICP', 'BORDERLINE');

-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN     "vaReview" "VaReviewStatus" NOT NULL DEFAULT 'UNREVIEWED';

-- CreateIndex
CREATE INDEX "KnownAdvertiser_vaReview_idx" ON "KnownAdvertiser"("vaReview");
