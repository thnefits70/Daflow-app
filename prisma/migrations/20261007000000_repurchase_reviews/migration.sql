-- CreateEnum
CREATE TYPE "RepurchaseReviewStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'USED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RepurchaseReview" (
    "id" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "freightTotal" DOUBLE PRECISION,
    "quantity" INTEGER NOT NULL,
    "competitorId" TEXT,
    "competitorPrice" DOUBLE PRECISION,
    "noCompetitorNote" TEXT,
    "lastUnitCost" DOUBLE PRECISION,
    "lastSupplierName" TEXT,
    "lastPurchaseAt" TIMESTAMP(3),
    "lastCompetitorPrice" DOUBLE PRECISION,
    "lastMarginAtCompetitor" DOUBLE PRECISION,
    "publishedDropiPrice" DOUBLE PRECISION,
    "newDropiPrice" DOUBLE PRECISION NOT NULL,
    "marginAtCompetitor" DOUBLE PRECISION,
    "maxSupplierCost" DOUBLE PRECISION,
    "marginPercent" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "verdict" TEXT NOT NULL,
    "stockAtRequest" INTEGER NOT NULL,
    "soldLast30" INTEGER NOT NULL,
    "daysLeft" DOUBLE PRECISION,
    "audience" TEXT NOT NULL,
    "note" TEXT,
    "status" "RepurchaseReviewStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedQuantity" INTEGER,
    "rejectReason" TEXT,
    "approvalExpiresAt" TIMESTAMP(3),
    "usedGroupId" TEXT,
    "usedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "RepurchaseReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepurchaseReview_code_key" ON "RepurchaseReview"("code");

-- CreateIndex
CREATE INDEX "RepurchaseReview_catalogItemId_idx" ON "RepurchaseReview"("catalogItemId");

-- CreateIndex
CREATE INDEX "RepurchaseReview_status_idx" ON "RepurchaseReview"("status");

-- CreateIndex
CREATE INDEX "RepurchaseReview_requestedById_idx" ON "RepurchaseReview"("requestedById");

-- CreateIndex
CREATE INDEX "RepurchaseReview_usedGroupId_idx" ON "RepurchaseReview"("usedGroupId");

-- AddForeignKey
ALTER TABLE "RepurchaseReview" ADD CONSTRAINT "RepurchaseReview_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepurchaseReview" ADD CONSTRAINT "RepurchaseReview_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepurchaseReview" ADD CONSTRAINT "RepurchaseReview_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepurchaseReview" ADD CONSTRAINT "RepurchaseReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

