-- CreateEnum
CREATE TYPE "PurchasePriceCorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'PRICE_CORRECTION';

-- CreateTable
CREATE TABLE "PurchasePriceCorrection" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "oldUnitCost" DOUBLE PRECISION NOT NULL,
    "newUnitCost" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "proofUrl" TEXT NOT NULL,
    "proofName" TEXT,
    "status" "PurchasePriceCorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "kardexAdjustedUnits" INTEGER,
    "kardexEntryId" TEXT,

    CONSTRAINT "PurchasePriceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchasePriceCorrection_kardexEntryId_key" ON "PurchasePriceCorrection"("kardexEntryId");

-- CreateIndex
CREATE INDEX "PurchasePriceCorrection_requestId_idx" ON "PurchasePriceCorrection"("requestId");

-- CreateIndex
CREATE INDEX "PurchasePriceCorrection_status_idx" ON "PurchasePriceCorrection"("status");

-- AddForeignKey
ALTER TABLE "PurchasePriceCorrection" ADD CONSTRAINT "PurchasePriceCorrection_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePriceCorrection" ADD CONSTRAINT "PurchasePriceCorrection_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePriceCorrection" ADD CONSTRAINT "PurchasePriceCorrection_kardexEntryId_fkey" FOREIGN KEY ("kardexEntryId") REFERENCES "StockKardexEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

