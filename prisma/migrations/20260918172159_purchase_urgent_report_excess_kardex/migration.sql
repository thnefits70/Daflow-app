-- AlterTable
ALTER TABLE "PurchaseRequestUrgentReport" ADD COLUMN     "excessKardexRecordedAt" TIMESTAMP(3),
ADD COLUMN     "excessKardexRecordedById" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseRequestUrgentReport" ADD CONSTRAINT "PurchaseRequestUrgentReport_excessKardexRecordedById_fkey" FOREIGN KEY ("excessKardexRecordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

