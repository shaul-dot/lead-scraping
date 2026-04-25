-- CreateTable
CREATE TABLE "KnownAdvertiser" (
    "id" TEXT NOT NULL,
    "companyName" TEXT,
    "fullName" TEXT,
    "firstName" TEXT,
    "websiteDomain" TEXT NOT NULL,
    "websiteUrlOriginal" TEXT,
    "email" TEXT,
    "country" TEXT,
    "addedBy" TEXT,
    "addedDate" TIMESTAMP(3),
    "leadSource" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnownAdvertiser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnownAdvertiser_websiteDomain_idx" ON "KnownAdvertiser"("websiteDomain");

-- CreateIndex
CREATE INDEX "KnownAdvertiser_fullName_idx" ON "KnownAdvertiser"("fullName");
