-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailVerificationStatus" AS ENUM ('PENDING', 'VALID', 'INVALID', 'RISKY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VerificationService" AS ENUM ('NEVERBOUNCE', 'BOUNCEBAN');

-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN "verificationStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN "verificationCompletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN "verifiedEmailCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN "emailVerifiedPrimary" TEXT;

-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN "emailVerifiedSecondary" TEXT;

-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN "emailVerifiedTertiary" TEXT;

-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN "leadMagnet" TEXT;

-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN "personalizedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LeadEmail" ADD COLUMN "verificationStatus" "EmailVerificationStatus";

-- AlterTable
ALTER TABLE "LeadEmail" ADD COLUMN "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "leadEmailId" TEXT NOT NULL,
    "service" "VerificationService" NOT NULL,
    "resultCode" TEXT NOT NULL,
    "status" "EmailVerificationStatus" NOT NULL,
    "rawResponse" JSONB,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creditsCost" INTEGER,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailVerification_leadEmailId_idx" ON "EmailVerification"("leadEmailId");

-- CreateIndex
CREATE INDEX "EmailVerification_service_verifiedAt_idx" ON "EmailVerification"("service", "verifiedAt");

-- CreateIndex
CREATE INDEX "KnownAdvertiser_verificationStatus_idx" ON "KnownAdvertiser"("verificationStatus");

-- CreateIndex
CREATE INDEX "KnownAdvertiser_enrichmentStatus_verificationStatus_idx" ON "KnownAdvertiser"("enrichmentStatus", "verificationStatus");

-- AddForeignKey
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_leadEmailId_fkey" FOREIGN KEY ("leadEmailId") REFERENCES "LeadEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;
