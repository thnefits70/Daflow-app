-- AlterTable
ALTER TABLE "MarketProductProposal" ADD COLUMN     "discoverySourceNote" TEXT,
ADD COLUMN     "noCompetitorData" BOOLEAN NOT NULL DEFAULT false;

