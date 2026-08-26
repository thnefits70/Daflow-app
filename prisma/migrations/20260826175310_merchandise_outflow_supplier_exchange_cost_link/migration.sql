-- AlterTable
ALTER TABLE "MerchandiseOutflowItem" ADD COLUMN     "linkedPurchaseRequestId" TEXT,
ADD COLUMN     "unitCostAtExchange" DOUBLE PRECISION,
ADD COLUMN     "expectedCreditAmount" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "MerchandiseOutflowItem_linkedPurchaseRequestId_idx" ON "MerchandiseOutflowItem"("linkedPurchaseRequestId");

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_linkedPurchaseRequestId_fkey" FOREIGN KEY ("linkedPurchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
