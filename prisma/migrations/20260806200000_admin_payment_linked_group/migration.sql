-- AlterTable
ALTER TABLE "AdminPaymentRequest" ADD COLUMN "linkedGroupId" TEXT;

-- CreateIndex
CREATE INDEX "AdminPaymentRequest_linkedGroupId_idx" ON "AdminPaymentRequest"("linkedGroupId");
