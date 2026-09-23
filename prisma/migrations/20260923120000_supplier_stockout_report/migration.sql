-- CreateEnum
CREATE TYPE "SupplierStockoutResolutionAction" AS ENUM ('CLOSED_DROPI_ID', 'STOCK_ZEROED', 'OTHER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canResolveSupplierStockout" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SupplierStockoutReport" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "instructionNote" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution" "SupplierStockoutResolutionAction",
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SupplierStockoutReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierStockoutReport_resolvedAt_idx" ON "SupplierStockoutReport"("resolvedAt");

-- CreateIndex
CREATE INDEX "SupplierStockoutReport_catalogItemId_idx" ON "SupplierStockoutReport"("catalogItemId");

-- AddForeignKey
ALTER TABLE "SupplierStockoutReport" ADD CONSTRAINT "SupplierStockoutReport_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierStockoutReport" ADD CONSTRAINT "SupplierStockoutReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierStockoutReport" ADD CONSTRAINT "SupplierStockoutReport_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

