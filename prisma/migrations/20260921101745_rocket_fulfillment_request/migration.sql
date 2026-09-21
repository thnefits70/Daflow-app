-- CreateEnum
CREATE TYPE "FulfillmentRequestSource" AS ENUM ('ROCKET', 'DROPI');

-- CreateTable
CREATE TABLE "RocketCodeMapping" (
    "id" TEXT NOT NULL,
    "rocketCode" TEXT NOT NULL,
    "rocketName" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "dropiComboId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RocketCodeMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentRequestBatch" (
    "id" TEXT NOT NULL,
    "source" "FulfillmentRequestSource" NOT NULL,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalRows" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FulfillmentRequestBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentRequestItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "fromComboCode" TEXT,

    CONSTRAINT "FulfillmentRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RocketCodeMapping_rocketCode_key" ON "RocketCodeMapping"("rocketCode");

-- CreateIndex
CREATE INDEX "FulfillmentRequestBatch_requestedAt_idx" ON "FulfillmentRequestBatch"("requestedAt");

-- CreateIndex
CREATE INDEX "FulfillmentRequestItem_batchId_idx" ON "FulfillmentRequestItem"("batchId");

-- CreateIndex
CREATE INDEX "FulfillmentRequestItem_catalogItemId_idx" ON "FulfillmentRequestItem"("catalogItemId");

-- AddForeignKey
ALTER TABLE "RocketCodeMapping" ADD CONSTRAINT "RocketCodeMapping_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RocketCodeMapping" ADD CONSTRAINT "RocketCodeMapping_dropiComboId_fkey" FOREIGN KEY ("dropiComboId") REFERENCES "DropiCombo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RocketCodeMapping" ADD CONSTRAINT "RocketCodeMapping_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentRequestBatch" ADD CONSTRAINT "FulfillmentRequestBatch_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentRequestItem" ADD CONSTRAINT "FulfillmentRequestItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FulfillmentRequestBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentRequestItem" ADD CONSTRAINT "FulfillmentRequestItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

