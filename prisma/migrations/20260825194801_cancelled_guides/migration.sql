-- CreateEnum
CREATE TYPE "CancelledGuideSourceArea" AS ENUM ('MKT_DAMIAN', 'MKT_PROVEDIX', 'FULFILLMENT');

-- CreateEnum
CREATE TYPE "CancelledGuideCarrier" AS ENUM ('SERVIENTREGA', 'URBANO', 'GINTRANCOM', 'LAARCOURIER', 'VELOCES');

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "lastCancelledGuideNumber" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CancelledGuideReport" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "reportNumber" INTEGER NOT NULL,
    "submittedById" TEXT NOT NULL,
    "sourceArea" "CancelledGuideSourceArea" NOT NULL,
    "guideNumber" TEXT NOT NULL,
    "carrier" "CancelledGuideCarrier" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfillmentConfirmedAt" TIMESTAMP(3),
    "fulfillmentConfirmedById" TEXT,
    "inventoryConfirmedAt" TIMESTAMP(3),
    "inventoryConfirmedById" TEXT,
    "reallyCancelled" BOOLEAN,
    "cutoffDecidedAt" TIMESTAMP(3),
    "cutoffDecidedById" TEXT,
    "reingresadoAt" TIMESTAMP(3),
    "reingresadoById" TEXT,

    CONSTRAINT "CancelledGuideReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancelledGuideItem" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "declaredName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "CancelledGuideItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CancelledGuideReport_code_key" ON "CancelledGuideReport"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CancelledGuideReport_reportNumber_key" ON "CancelledGuideReport"("reportNumber");

-- CreateIndex
CREATE INDEX "CancelledGuideReport_createdAt_idx" ON "CancelledGuideReport"("createdAt");

-- CreateIndex
CREATE INDEX "CancelledGuideReport_reallyCancelled_idx" ON "CancelledGuideReport"("reallyCancelled");

-- CreateIndex
CREATE INDEX "CancelledGuideReport_submittedById_idx" ON "CancelledGuideReport"("submittedById");

-- CreateIndex
CREATE INDEX "CancelledGuideItem_reportId_idx" ON "CancelledGuideItem"("reportId");

-- AddForeignKey
ALTER TABLE "CancelledGuideReport" ADD CONSTRAINT "CancelledGuideReport_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancelledGuideReport" ADD CONSTRAINT "CancelledGuideReport_fulfillmentConfirmedById_fkey" FOREIGN KEY ("fulfillmentConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancelledGuideReport" ADD CONSTRAINT "CancelledGuideReport_inventoryConfirmedById_fkey" FOREIGN KEY ("inventoryConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancelledGuideReport" ADD CONSTRAINT "CancelledGuideReport_cutoffDecidedById_fkey" FOREIGN KEY ("cutoffDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancelledGuideReport" ADD CONSTRAINT "CancelledGuideReport_reingresadoById_fkey" FOREIGN KEY ("reingresadoById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancelledGuideItem" ADD CONSTRAINT "CancelledGuideItem_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CancelledGuideReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancelledGuideItem" ADD CONSTRAINT "CancelledGuideItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

