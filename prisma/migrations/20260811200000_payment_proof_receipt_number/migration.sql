ALTER TABLE "PurchaseRequest" ADD COLUMN "paymentProofReceiptNumber" TEXT;
ALTER TABLE "PurchaseRequest" ADD COLUMN "shippingPaymentProofReceiptNumber" TEXT;

CREATE INDEX "PurchaseRequest_paymentProofReceiptNumber_idx" ON "PurchaseRequest"("paymentProofReceiptNumber");
CREATE INDEX "PurchaseRequest_shippingPaymentProofReceiptNumber_idx" ON "PurchaseRequest"("shippingPaymentProofReceiptNumber");
