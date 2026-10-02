-- CreateTable
CREATE TABLE "StockLabelPrint" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "printedById" TEXT,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLabelPrint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockLabelPrint_catalogItemId_idx" ON "StockLabelPrint"("catalogItemId");

-- AddForeignKey
ALTER TABLE "StockLabelPrint" ADD CONSTRAINT "StockLabelPrint_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLabelPrint" ADD CONSTRAINT "StockLabelPrint_printedById_fkey" FOREIGN KEY ("printedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
