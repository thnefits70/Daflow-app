-- CreateTable
CREATE TABLE "FulfillmentRequestVariantNote" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FulfillmentRequestVariantNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FulfillmentRequestVariantNote_batchId_catalogItemId_idx" ON "FulfillmentRequestVariantNote"("batchId", "catalogItemId");

-- AddForeignKey
ALTER TABLE "FulfillmentRequestVariantNote" ADD CONSTRAINT "FulfillmentRequestVariantNote_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FulfillmentRequestBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentRequestVariantNote" ADD CONSTRAINT "FulfillmentRequestVariantNote_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentRequestVariantNote" ADD CONSTRAINT "FulfillmentRequestVariantNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

