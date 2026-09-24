-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "publicSheetToken" TEXT,
ADD COLUMN     "publicSheetTokenCreatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SupplierSheetTab" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "colWidths" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierSheetTab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierSheetCell" (
    "id" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "col" INTEGER NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "style" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierSheetCell_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierSheetTab_supplierId_idx" ON "SupplierSheetTab"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierSheetCell_tabId_row_col_key" ON "SupplierSheetCell"("tabId", "row", "col");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_publicSheetToken_key" ON "Supplier"("publicSheetToken");

-- AddForeignKey
ALTER TABLE "SupplierSheetTab" ADD CONSTRAINT "SupplierSheetTab_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierSheetCell" ADD CONSTRAINT "SupplierSheetCell_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "SupplierSheetTab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

