-- CreateTable
CREATE TABLE "FulfillmentProvisionalLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "carrier" TEXT,
    "variants" TEXT,

    CONSTRAINT "FulfillmentProvisionalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FulfillmentProvisionalLine_batchId_idx" ON "FulfillmentProvisionalLine"("batchId");

-- AddForeignKey
ALTER TABLE "FulfillmentProvisionalLine" ADD CONSTRAINT "FulfillmentProvisionalLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FulfillmentRequestBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
