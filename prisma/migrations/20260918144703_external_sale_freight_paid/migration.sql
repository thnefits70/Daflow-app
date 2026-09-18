-- AlterTable
ALTER TABLE "ExternalSale" ADD COLUMN     "freightPaidAt" TIMESTAMP(3),
ADD COLUMN     "freightPaidById" TEXT;

-- AlterTable
ALTER TABLE "PettyCashEntry" ADD COLUMN     "linkedExternalSaleId" TEXT;

-- CreateIndex
CREATE INDEX "PettyCashEntry_linkedExternalSaleId_idx" ON "PettyCashEntry"("linkedExternalSaleId");

-- AddForeignKey
ALTER TABLE "PettyCashEntry" ADD CONSTRAINT "PettyCashEntry_linkedExternalSaleId_fkey" FOREIGN KEY ("linkedExternalSaleId") REFERENCES "ExternalSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_freightPaidById_fkey" FOREIGN KEY ("freightPaidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

