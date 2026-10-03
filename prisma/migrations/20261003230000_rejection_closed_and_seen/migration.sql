-- AlterTable
ALTER TABLE "MarketProductProposal" ADD COLUMN     "rejectionSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "rejectionClosedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionClosedNote" TEXT;
