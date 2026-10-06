-- AlterTable
ALTER TABLE "PurchaseRequestReceipt" ADD COLUMN     "variantCounts" JSONB;

-- CreateTable
CREATE TABLE "ProductVariantMovement" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVariantMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductVariantMovement_variantId_idx" ON "ProductVariantMovement"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariantMovement_variantId_reason_refId_key" ON "ProductVariantMovement"("variantId", "reason", "refId");

-- AddForeignKey
ALTER TABLE "ProductVariantMovement" ADD CONSTRAINT "ProductVariantMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

