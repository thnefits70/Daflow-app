-- AlterTable
ALTER TABLE "FulfillmentRequestGuide" ADD COLUMN "destCity" TEXT,
ADD COLUMN "destProvince" TEXT,
ADD COLUMN "codAmount" DECIMAL(10,2),
ADD COLUMN "buyerGender" TEXT,
ADD COLUMN "senderPhone" TEXT,
ADD COLUMN "marketReadAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FulfillmentRequestGuide_marketReadAt_idx" ON "FulfillmentRequestGuide"("marketReadAt");
