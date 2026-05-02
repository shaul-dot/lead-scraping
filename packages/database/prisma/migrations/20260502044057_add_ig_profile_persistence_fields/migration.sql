-- AlterTable
ALTER TABLE "KnownAdvertiser" ADD COLUMN     "biography" TEXT,
ADD COLUMN     "businessEmail" TEXT,
ADD COLUMN     "rawProfileMetadata" JSONB;
