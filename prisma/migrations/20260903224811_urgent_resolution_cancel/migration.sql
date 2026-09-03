-- AlterEnum
ALTER TYPE "SupplierCreditStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "PurchaseUrgentResolution" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseUrgentResolution" ADD CONSTRAINT "PurchaseUrgentResolution_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

