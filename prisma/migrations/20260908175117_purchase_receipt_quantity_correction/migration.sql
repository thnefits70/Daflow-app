-- AlterTable
ALTER TABLE "PurchaseRequestReceipt" ADD COLUMN     "originalReceivedQuantity" INTEGER,
ADD COLUMN     "quantityCorrectedAt" TIMESTAMP(3),
ADD COLUMN     "quantityCorrectedById" TEXT,
ADD COLUMN     "quantityCorrectionNote" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseRequestReceipt" ADD CONSTRAINT "PurchaseRequestReceipt_quantityCorrectedById_fkey" FOREIGN KEY ("quantityCorrectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

