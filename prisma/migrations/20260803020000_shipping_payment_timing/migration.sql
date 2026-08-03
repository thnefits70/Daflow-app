-- CreateEnum
CREATE TYPE "ShippingPaymentTiming" AS ENUM ('WITH_PURCHASE', 'ON_DELIVERY');

-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN "shippingPaymentTiming" "ShippingPaymentTiming";
ALTER TABLE "PurchaseRequest" ADD COLUMN "carrierBankAccountId" TEXT;
ALTER TABLE "PurchaseRequest" ADD COLUMN "shippingPaymentRequestedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseRequest" ADD COLUMN "shippingPaidAt" TIMESTAMP(3);
ALTER TABLE "PurchaseRequest" ADD COLUMN "shippingPaymentProofUrl" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_carrierBankAccountId_fkey" FOREIGN KEY ("carrierBankAccountId") REFERENCES "SupplierBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
