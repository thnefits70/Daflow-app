-- AlterTable
ALTER TABLE "MerchandiseOutflowItem" ADD COLUMN     "groupedSupplierCreditId" TEXT;

-- AlterTable
ALTER TABLE "SupplierCredit" ADD COLUMN     "proofAiCheck" JSONB,
ADD COLUMN     "proofHash" TEXT,
ADD COLUMN     "proofMismatchNote" TEXT;

-- CreateTable
CREATE TABLE "SupplierProductCode" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProductCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProductCode_supplierId_code_key" ON "SupplierProductCode"("supplierId", "code");

-- CreateIndex
CREATE INDEX "SupplierCredit_proofHash_idx" ON "SupplierCredit"("proofHash");

-- AddForeignKey
ALTER TABLE "SupplierProductCode" ADD CONSTRAINT "SupplierProductCode_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductCode" ADD CONSTRAINT "SupplierProductCode_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductCode" ADD CONSTRAINT "SupplierProductCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_groupedSupplierCreditId_fkey" FOREIGN KEY ("groupedSupplierCreditId") REFERENCES "SupplierCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

