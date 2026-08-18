-- AlterTable
ALTER TABLE "PurchaseRequestReceipt" ADD COLUMN     "justaUploadedAt" TIMESTAMP(3),
ADD COLUMN     "justaUploadedById" TEXT;

-- AlterTable
ALTER TABLE "PurchaseUrgentResolution" ADD COLUMN     "justaUploadedAt" TIMESTAMP(3),
ADD COLUMN     "justaUploadedById" TEXT,
ADD COLUMN     "replacementSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "replacementSubmittedById" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseRequestReceipt" ADD CONSTRAINT "PurchaseRequestReceipt_justaUploadedById_fkey" FOREIGN KEY ("justaUploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseUrgentResolution" ADD CONSTRAINT "PurchaseUrgentResolution_replacementSubmittedById_fkey" FOREIGN KEY ("replacementSubmittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseUrgentResolution" ADD CONSTRAINT "PurchaseUrgentResolution_justaUploadedById_fkey" FOREIGN KEY ("justaUploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

