-- CreateEnum
CREATE TYPE "PurchaseExceptionDecision" AS ENUM ('DATA_CORRECTED', 'AUTHORIZED', 'REJECTED');

-- AlterTable
ALTER TABLE "MerchandiseOutflowItem" ADD COLUMN     "purchaseExceptionDecidedAt" TIMESTAMP(3),
ADD COLUMN     "purchaseExceptionDecidedById" TEXT,
ADD COLUMN     "purchaseExceptionDecision" "PurchaseExceptionDecision",
ADD COLUMN     "purchaseExceptionNote" TEXT,
ADD COLUMN     "purchaseGestionSupplierId" TEXT,
ADD COLUMN     "purchaseNoMatchNote" TEXT,
ADD COLUMN     "purchaseNoMatchReportedAt" TIMESTAMP(3),
ADD COLUMN     "purchaseNoMatchReportedById" TEXT,
ADD COLUMN     "purchaseResolution" "OutflowItemResolution",
ADD COLUMN     "purchaseResolutionNote" TEXT,
ADD COLUMN     "purchaseResolvedAt" TIMESTAMP(3),
ADD COLUMN     "purchaseResolvedById" TEXT;

-- CreateIndex
CREATE INDEX "MerchandiseOutflowItem_purchaseGestionSupplierId_idx" ON "MerchandiseOutflowItem"("purchaseGestionSupplierId");

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_purchaseGestionSupplierId_fkey" FOREIGN KEY ("purchaseGestionSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_purchaseResolvedById_fkey" FOREIGN KEY ("purchaseResolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_purchaseNoMatchReportedById_fkey" FOREIGN KEY ("purchaseNoMatchReportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_purchaseExceptionDecidedById_fkey" FOREIGN KEY ("purchaseExceptionDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

