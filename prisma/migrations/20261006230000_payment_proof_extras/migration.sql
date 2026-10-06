-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "paymentProofExtraReceiptNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "paymentProofExtraUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "shippingPaymentProofExtraReceiptNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "shippingPaymentProofExtraUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
