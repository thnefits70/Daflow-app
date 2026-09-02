-- AlterEnum
ALTER TYPE "CancelledGuideSourceArea" ADD VALUE 'MKT_SHANGHAI';

-- DropIndex
DROP INDEX "CancelledGuideReport_reallyCancelled_idx";

-- AlterTable
ALTER TABLE "CancelledGuideReport" ADD COLUMN     "batchCode" TEXT,
ADD COLUMN     "batchManagedAt" TIMESTAMP(3),
ADD COLUMN     "batchManagedById" TEXT,
ADD COLUMN     "itemsAssignedAt" TIMESTAMP(3),
ADD COLUMN     "itemsAssignedById" TEXT;

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "lastCancelledGuideBatchNumber" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canAssignCancelledGuideItems" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "CancelledGuideReport_batchCode_idx" ON "CancelledGuideReport"("batchCode");

-- CreateIndex
CREATE INDEX "CancelledGuideReport_batchManagedAt_idx" ON "CancelledGuideReport"("batchManagedAt");

-- CreateIndex
CREATE INDEX "CancelledGuideReport_itemsAssignedAt_idx" ON "CancelledGuideReport"("itemsAssignedAt");

-- AddForeignKey
ALTER TABLE "CancelledGuideReport" ADD CONSTRAINT "CancelledGuideReport_batchManagedById_fkey" FOREIGN KEY ("batchManagedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancelledGuideReport" ADD CONSTRAINT "CancelledGuideReport_itemsAssignedById_fkey" FOREIGN KEY ("itemsAssignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

