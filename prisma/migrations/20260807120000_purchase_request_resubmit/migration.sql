-- AlterTable
ALTER TABLE "PurchaseRequest" ALTER COLUMN "shippingIncluded" SET DEFAULT false;
ALTER TABLE "PurchaseRequest" ADD COLUMN "attemptNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PurchaseRequest" ADD COLUMN "resubmittedFromGroupId" TEXT;

-- CreateIndex
CREATE INDEX "PurchaseRequest_resubmittedFromGroupId_idx" ON "PurchaseRequest"("resubmittedFromGroupId");
