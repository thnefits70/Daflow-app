-- AlterTable
ALTER TABLE "PurchaseRequestUrgentReport" ADD COLUMN "supplierStockoutAt" TIMESTAMP(3),
ADD COLUMN "supplierStockoutById" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseRequestUrgentReport" ADD CONSTRAINT "PurchaseRequestUrgentReport_supplierStockoutById_fkey" FOREIGN KEY ("supplierStockoutById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
