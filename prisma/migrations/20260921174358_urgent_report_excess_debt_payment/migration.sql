-- AlterTable
ALTER TABLE "PurchaseRequestUrgentReport" ADD COLUMN     "excessDebtPaymentId" TEXT;

-- CreateIndex
CREATE INDEX "PurchaseRequestUrgentReport_excessDebtPaymentId_idx" ON "PurchaseRequestUrgentReport"("excessDebtPaymentId");

-- AddForeignKey
ALTER TABLE "PurchaseRequestUrgentReport" ADD CONSTRAINT "PurchaseRequestUrgentReport_excessDebtPaymentId_fkey" FOREIGN KEY ("excessDebtPaymentId") REFERENCES "SupplierDebtPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

