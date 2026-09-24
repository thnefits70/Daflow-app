-- CreateEnum
CREATE TYPE "SupplierSheetSide" AS ENUM ('SUPPLIER', 'OWN');

-- AlterTable
ALTER TABLE "SupplierSheetCell" ADD COLUMN     "authorEmail" TEXT,
ADD COLUMN     "authorSide" "SupplierSheetSide";

-- AlterTable
ALTER TABLE "SupplierSheetEmail" ADD COLUMN     "side" "SupplierSheetSide" NOT NULL DEFAULT 'SUPPLIER';

-- AlterTable
ALTER TABLE "SupplierSheetTab" ADD COLUMN     "createdBySide" "SupplierSheetSide";

-- CreateTable
CREATE TABLE "SupplierSheetCellLog" (
    "id" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "col" INTEGER NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "oldStyle" JSONB,
    "newStyle" JSONB,
    "email" TEXT NOT NULL,
    "side" "SupplierSheetSide" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierSheetCellLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierSheetCellLog_tabId_row_col_idx" ON "SupplierSheetCellLog"("tabId", "row", "col");

-- AddForeignKey
ALTER TABLE "SupplierSheetCellLog" ADD CONSTRAINT "SupplierSheetCellLog_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "SupplierSheetTab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

