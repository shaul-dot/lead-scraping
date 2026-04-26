-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN     "aiNiche" TEXT,
ADD COLUMN     "aiOfferingType" TEXT,
ADD COLUMN     "aiQualificationCategory" TEXT,
ADD COLUMN     "aiQualificationConfidence" TEXT,
ADD COLUMN     "aiQualificationReason" TEXT,
ADD COLUMN     "aiQualificationStage" INTEGER,
ADD COLUMN     "aiSocialProof" TEXT,
ADD COLUMN     "aiSpecificOffering" TEXT,
ADD COLUMN     "aiSubNiche" TEXT,
ADD COLUMN     "aiToneSignals" TEXT,
ADD COLUMN     "aiUniqueAngle" TEXT,
ADD COLUMN     "aiUrlFetchAttempted" BOOLEAN,
ADD COLUMN     "aiUrlFetchSucceeded" BOOLEAN;

-- CreateIndex
CREATE INDEX "KnownAdvertiser_aiQualificationCategory_idx" ON "KnownAdvertiser"("aiQualificationCategory");
