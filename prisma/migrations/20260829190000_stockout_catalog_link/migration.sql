-- AlterTable
ALTER TABLE "StockoutProduct" ADD COLUMN     "catalogItemId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "StockoutProduct_catalogItemId_key" ON "StockoutProduct"("catalogItemId");

-- AddForeignKey
ALTER TABLE "StockoutProduct" ADD CONSTRAINT "StockoutProduct_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

