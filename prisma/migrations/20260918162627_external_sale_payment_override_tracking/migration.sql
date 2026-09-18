-- AlterTable
ALTER TABLE "ExternalSale" ADD COLUMN     "paymentOverrideAt" TIMESTAMP(3),
ADD COLUMN     "paymentOverrideById" TEXT;

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_paymentOverrideById_fkey" FOREIGN KEY ("paymentOverrideById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

