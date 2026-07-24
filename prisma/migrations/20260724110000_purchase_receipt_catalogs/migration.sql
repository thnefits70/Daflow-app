-- AlterTable
ALTER TABLE "PurchaseReceipt" DROP COLUMN "proveedor",
ADD COLUMN     "bankId" TEXT,
ADD COLUMN     "numeroComprobante" TEXT,
ADD COLUMN     "supplierId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PurchaseReceiptChangeRequest" DROP COLUMN "proposedProveedor",
ADD COLUMN     "proposedBankId" TEXT,
ADD COLUMN     "proposedNumeroComprobante" TEXT,
ADD COLUMN     "proposedSupplierId" TEXT;

-- CreateTable
CREATE TABLE "PurchaseReceiptSupplier" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReceiptSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceiptBank" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReceiptBank_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseReceiptSupplier_deptId_idx" ON "PurchaseReceiptSupplier"("deptId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceiptSupplier_deptId_name_key" ON "PurchaseReceiptSupplier"("deptId", "name");

-- CreateIndex
CREATE INDEX "PurchaseReceiptBank_deptId_idx" ON "PurchaseReceiptBank"("deptId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceiptBank_deptId_name_key" ON "PurchaseReceiptBank"("deptId", "name");

-- CreateIndex
CREATE INDEX "PurchaseReceipt_supplierId_idx" ON "PurchaseReceipt"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseReceipt_fechaPago_idx" ON "PurchaseReceipt"("fechaPago");

-- AddForeignKey
ALTER TABLE "PurchaseReceiptSupplier" ADD CONSTRAINT "PurchaseReceiptSupplier_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptBank" ADD CONSTRAINT "PurchaseReceiptBank_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "PurchaseReceiptSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "PurchaseReceiptBank"("id") ON DELETE SET NULL ON UPDATE CASCADE;
