-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "buyerDebtConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "buyerDebtConfirmedById" TEXT,
ADD COLUMN     "buyerDebtRejectedAt" TIMESTAMP(3),
ADD COLUMN     "buyerDebtRejectedById" TEXT,
ADD COLUMN     "buyerDebtRejectionReason" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_buyerDebtConfirmedById_fkey" FOREIGN KEY ("buyerDebtConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_buyerDebtRejectedById_fkey" FOREIGN KEY ("buyerDebtRejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

