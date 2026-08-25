-- CreateEnum
CREATE TYPE "LateClaimStockStatus" AS ENUM ('IN_STOCK', 'SOLD');

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "lastLateClaimNumber" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PurchaseRequestUrgentReport" ADD COLUMN     "estimatedUnitCost" DOUBLE PRECISION,
ADD COLUMN     "isLateClaim" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "justConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "justConfirmedById" TEXT,
ADD COLUMN     "justWriteOffQty" INTEGER,
ADD COLUMN     "lateClaimCode" TEXT,
ADD COLUMN     "originUncertain" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedById" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "stockStatus" "LateClaimStockStatus";

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequestUrgentReport_lateClaimCode_key" ON "PurchaseRequestUrgentReport"("lateClaimCode");

-- CreateIndex
CREATE INDEX "PurchaseRequestUrgentReport_isLateClaim_idx" ON "PurchaseRequestUrgentReport"("isLateClaim");

-- AddForeignKey
ALTER TABLE "PurchaseRequestUrgentReport" ADD CONSTRAINT "PurchaseRequestUrgentReport_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestUrgentReport" ADD CONSTRAINT "PurchaseRequestUrgentReport_justConfirmedById_fkey" FOREIGN KEY ("justConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

