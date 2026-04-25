-- AlterTable
ALTER TABLE "DailyStats" ADD COLUMN     "advertisersDeduped" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "advertisersFailed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "advertisersQualified" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "advertisersRejected" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "aiLeadsAddedToMaster" INTEGER NOT NULL DEFAULT 0;
