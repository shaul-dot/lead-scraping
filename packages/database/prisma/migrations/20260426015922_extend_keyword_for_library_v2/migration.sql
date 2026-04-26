-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "category" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "patternHint" TEXT,
ADD COLUMN     "subCategory" TEXT;

-- CreateIndex
CREATE INDEX "Keyword_patternHint_idx" ON "Keyword"("patternHint");

-- CreateIndex
CREATE INDEX "Keyword_category_idx" ON "Keyword"("category");
