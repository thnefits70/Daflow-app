-- AlterTable
ALTER TABLE "PurchaseCatalogItem" ADD COLUMN     "hasExpiration" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StockKardexEntry" ADD COLUMN     "sourceExpirationCohortId" TEXT;

-- CreateTable
CREATE TABLE "ExpirationCohort" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "manufactureDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3) NOT NULL,
    "quantityReceived" INTEGER NOT NULL,
    "quantityRemaining" INTEGER NOT NULL,
    "declaredById" TEXT,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sixMonthAlertSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpirationCohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockKardexEntryLotAllocation" (
    "id" TEXT NOT NULL,
    "kardexEntryId" TEXT NOT NULL,
    "expirationCohortId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockKardexEntryLotAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpirationCohort_catalogItemId_idx" ON "ExpirationCohort"("catalogItemId");

-- CreateIndex
CREATE INDEX "ExpirationCohort_expirationDate_idx" ON "ExpirationCohort"("expirationDate");

-- CreateIndex
CREATE INDEX "StockKardexEntryLotAllocation_kardexEntryId_idx" ON "StockKardexEntryLotAllocation"("kardexEntryId");

-- CreateIndex
CREATE INDEX "StockKardexEntryLotAllocation_expirationCohortId_idx" ON "StockKardexEntryLotAllocation"("expirationCohortId");

-- CreateIndex
CREATE UNIQUE INDEX "StockKardexEntry_sourceExpirationCohortId_key" ON "StockKardexEntry"("sourceExpirationCohortId");

-- AddForeignKey
ALTER TABLE "StockKardexEntry" ADD CONSTRAINT "StockKardexEntry_sourceExpirationCohortId_fkey" FOREIGN KEY ("sourceExpirationCohortId") REFERENCES "ExpirationCohort"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpirationCohort" ADD CONSTRAINT "ExpirationCohort_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpirationCohort" ADD CONSTRAINT "ExpirationCohort_declaredById_fkey" FOREIGN KEY ("declaredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockKardexEntryLotAllocation" ADD CONSTRAINT "StockKardexEntryLotAllocation_kardexEntryId_fkey" FOREIGN KEY ("kardexEntryId") REFERENCES "StockKardexEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockKardexEntryLotAllocation" ADD CONSTRAINT "StockKardexEntryLotAllocation_expirationCohortId_fkey" FOREIGN KEY ("expirationCohortId") REFERENCES "ExpirationCohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

