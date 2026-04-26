-- CreateTable
CREATE TABLE "Hashtag" (
    "id" TEXT NOT NULL,
    "hashtag" TEXT NOT NULL,
    "category" TEXT,
    "tier" INTEGER,
    "notes" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hashtag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Hashtag_hashtag_key" ON "Hashtag"("hashtag");

-- CreateIndex
CREATE INDEX "Hashtag_enabled_lastUsedAt_idx" ON "Hashtag"("enabled", "lastUsedAt");

-- CreateIndex
CREATE INDEX "Hashtag_category_idx" ON "Hashtag"("category");
