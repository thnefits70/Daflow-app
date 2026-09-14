-- AlterTable
ALTER TABLE "ExternalSaleItem" ADD COLUMN     "marginPercentUsed" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canViewB2BPricing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canViewB2CPricing" BOOLEAN NOT NULL DEFAULT false;

