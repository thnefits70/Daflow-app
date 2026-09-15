-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "publicLedgerToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_publicLedgerToken_key" ON "Supplier"("publicLedgerToken");
