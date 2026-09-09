-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "StockKardexEntry" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DOUBLE PRECISION,
    "balanceAfter" INTEGER NOT NULL,
    "avgCostAfter" DOUBLE PRECISION NOT NULL,
    "purchaseRequestReceiptId" TEXT,
    "merchandiseOutflowItemId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockKardexEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockKardexJustComparison" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "justStock" DOUBLE PRECISION NOT NULL,
    "investockStock" INTEGER NOT NULL,
    "difference" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockKardexJustComparison_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockKardexEntry_purchaseRequestReceiptId_key" ON "StockKardexEntry"("purchaseRequestReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "StockKardexEntry_merchandiseOutflowItemId_key" ON "StockKardexEntry"("merchandiseOutflowItemId");

-- CreateIndex
CREATE INDEX "StockKardexEntry_catalogItemId_idx" ON "StockKardexEntry"("catalogItemId");

-- CreateIndex
CREATE INDEX "StockKardexEntry_occurredAt_idx" ON "StockKardexEntry"("occurredAt");

-- CreateIndex
CREATE INDEX "StockKardexJustComparison_period_idx" ON "StockKardexJustComparison"("period");

-- CreateIndex
CREATE UNIQUE INDEX "StockKardexJustComparison_period_catalogItemId_key" ON "StockKardexJustComparison"("period", "catalogItemId");

-- AddForeignKey
ALTER TABLE "StockKardexEntry" ADD CONSTRAINT "StockKardexEntry_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockKardexEntry" ADD CONSTRAINT "StockKardexEntry_purchaseRequestReceiptId_fkey" FOREIGN KEY ("purchaseRequestReceiptId") REFERENCES "PurchaseRequestReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockKardexEntry" ADD CONSTRAINT "StockKardexEntry_merchandiseOutflowItemId_fkey" FOREIGN KEY ("merchandiseOutflowItemId") REFERENCES "MerchandiseOutflowItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockKardexJustComparison" ADD CONSTRAINT "StockKardexJustComparison_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

