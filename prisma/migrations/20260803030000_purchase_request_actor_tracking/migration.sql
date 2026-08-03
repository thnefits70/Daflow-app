-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN "paidById" TEXT;
ALTER TABLE "PurchaseRequest" ADD COLUMN "invoicedById" TEXT;
ALTER TABLE "PurchaseRequest" ADD COLUMN "shippingPaymentRequestedById" TEXT;
ALTER TABLE "PurchaseRequest" ADD COLUMN "shippingPaidById" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_invoicedById_fkey" FOREIGN KEY ("invoicedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_shippingPaymentRequestedById_fkey" FOREIGN KEY ("shippingPaymentRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_shippingPaidById_fkey" FOREIGN KEY ("shippingPaidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
