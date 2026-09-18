-- AlterTable
ALTER TABLE "PurchaseRequestUrgentReport" ADD COLUMN     "excessConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "excessConfirmedById" TEXT,
ADD COLUMN     "excessGestionAt" TIMESTAMP(3),
ADD COLUMN     "excessGestionById" TEXT,
ADD COLUMN     "excessGestionNote" TEXT,
ADD COLUMN     "excessQty" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "PurchaseRequestUrgentReport" ADD CONSTRAINT "PurchaseRequestUrgentReport_excessGestionById_fkey" FOREIGN KEY ("excessGestionById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestUrgentReport" ADD CONSTRAINT "PurchaseRequestUrgentReport_excessConfirmedById_fkey" FOREIGN KEY ("excessConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

