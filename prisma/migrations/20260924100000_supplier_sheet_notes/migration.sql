-- AlterTable
ALTER TABLE "SupplierSheetCellLog" ADD COLUMN     "rowKey" TEXT;

-- CreateTable
CREATE TABLE "SupplierSheetAnchoredCell" (
    "id" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "col" INTEGER NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "style" JSONB,
    "authorSide" "SupplierSheetSide",
    "authorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierSheetAnchoredCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierSheetNote" (
    "id" TEXT NOT NULL,
    "noteKey" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "tabName" TEXT NOT NULL,
    "requestId" TEXT,
    "debtPaymentId" TEXT,
    "text" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "notifiedTo" TEXT[],
    "routeMethod" TEXT,
    "routeReason" TEXT,
    "lastNotifiedAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierSheetNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierSheetAnchoredCell_tabId_rowKey_col_key" ON "SupplierSheetAnchoredCell"("tabId", "rowKey", "col");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierSheetNote_noteKey_key" ON "SupplierSheetNote"("noteKey");

-- CreateIndex
CREATE INDEX "SupplierSheetNote_supplierId_updatedAt_idx" ON "SupplierSheetNote"("supplierId", "updatedAt");

-- AddForeignKey
ALTER TABLE "SupplierSheetAnchoredCell" ADD CONSTRAINT "SupplierSheetAnchoredCell_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "SupplierSheetTab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierSheetNote" ADD CONSTRAINT "SupplierSheetNote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierSheetNote" ADD CONSTRAINT "SupplierSheetNote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

