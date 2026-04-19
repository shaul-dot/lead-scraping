-- CreateEnum
CREATE TYPE "AdvertiserQualStatus" AS ENUM ('UNQUALIFIED', 'QUALIFYING', 'QUALIFIED', 'REJECTED_QUALIFICATION', 'QUALIFICATION_FAILED');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "advertiserId" TEXT;

-- CreateTable
CREATE TABLE "Advertiser" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "pageName" TEXT NOT NULL,
    "status" "AdvertiserQualStatus" NOT NULL DEFAULT 'UNQUALIFIED',
    "category" TEXT,
    "confidence" TEXT,
    "qualificationReason" TEXT,
    "qualifiedAt" TIMESTAMP(3),
    "landingPageUrl" TEXT,
    "landingPageContent" TEXT,
    "personName" TEXT,
    "businessName" TEXT,
    "niche" TEXT,
    "subNiche" TEXT,
    "offeringType" TEXT,
    "specificOffering" TEXT,
    "uniqueAngle" TEXT,
    "socialProof" TEXT,
    "toneSignals" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Advertiser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Advertiser_pageId_key" ON "Advertiser"("pageId");

-- CreateIndex
CREATE INDEX "Advertiser_status_idx" ON "Advertiser"("status");

-- CreateIndex
CREATE INDEX "Advertiser_category_idx" ON "Advertiser"("category");

-- CreateIndex
CREATE INDEX "Advertiser_niche_idx" ON "Advertiser"("niche");

-- CreateIndex
CREATE INDEX "Lead_advertiserId_idx" ON "Lead"("advertiserId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "Advertiser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
