-- CreateEnum
CREATE TYPE "PurchaseReceiptAction" AS ENUM ('EDIT', 'DELETE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canViewPurchaseReceipts" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PurchaseReceipt" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "proveedor" TEXT NOT NULL,
    "monto" DOUBLE PRECISION NOT NULL,
    "fechaPago" TIMESTAMP(3) NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceiptChangeRequest" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "action" "PurchaseReceiptAction" NOT NULL,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposedProveedor" TEXT,
    "proposedMonto" DOUBLE PRECISION,
    "proposedFechaPago" TIMESTAMP(3),
    "proposedFileUrl" TEXT,
    "proposedFileName" TEXT,

    CONSTRAINT "PurchaseReceiptChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseReceipt_deptId_idx" ON "PurchaseReceipt"("deptId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceiptChangeRequest_receiptId_key" ON "PurchaseReceiptChangeRequest"("receiptId");

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptChangeRequest" ADD CONSTRAINT "PurchaseReceiptChangeRequest_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptChangeRequest" ADD CONSTRAINT "PurchaseReceiptChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
