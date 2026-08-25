-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OutflowItemResolution" ADD VALUE 'REPLACED';
ALTER TYPE "OutflowItemResolution" ADD VALUE 'CREDIT_ISSUED';

-- AlterEnum
ALTER TYPE "OutflowReason" ADD VALUE 'CAMBIO_PROVEEDOR';

-- AlterTable
ALTER TABLE "MerchandiseOutflowBatch" ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "SupplierCredit" ADD COLUMN     "outflowItemId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCredit_outflowItemId_key" ON "SupplierCredit"("outflowItemId");

-- AddForeignKey
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_outflowItemId_fkey" FOREIGN KEY ("outflowItemId") REFERENCES "MerchandiseOutflowItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowBatch" ADD CONSTRAINT "MerchandiseOutflowBatch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

