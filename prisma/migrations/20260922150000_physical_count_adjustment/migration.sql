-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'PHYSICAL_COUNT_ADJUSTMENT';

-- CreateTable
CREATE TABLE "StockPhysicalCountAdjustmentRequest" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "currentQuantityAtRequest" INTEGER NOT NULL,
    "requestedQuantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockPhysicalCountAdjustmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockPhysicalCountAdjustmentRequest_catalogItemId_key" ON "StockPhysicalCountAdjustmentRequest"("catalogItemId");

-- AddForeignKey
ALTER TABLE "StockPhysicalCountAdjustmentRequest" ADD CONSTRAINT "StockPhysicalCountAdjustmentRequest_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPhysicalCountAdjustmentRequest" ADD CONSTRAINT "StockPhysicalCountAdjustmentRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
