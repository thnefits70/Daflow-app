-- AlterTable
ALTER TABLE "PurchaseRequestUrgentReport" ADD COLUMN     "resolvedInternallyAt" TIMESTAMP(3),
ADD COLUMN     "resolvedInternallyById" TEXT,
ADD COLUMN     "resolvedInternallyNote" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseRequestUrgentReport" ADD CONSTRAINT "PurchaseRequestUrgentReport_resolvedInternallyById_fkey" FOREIGN KEY ("resolvedInternallyById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

