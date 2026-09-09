-- CreateEnum
CREATE TYPE "SupplierPaymentMode" AS ENUM ('PREPAGO', 'CREDITO');

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "lastSupplierDebtPaymentNumber" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "debtPaymentId" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "paymentMode" "SupplierPaymentMode" NOT NULL DEFAULT 'PREPAGO',
ADD COLUMN     "publicLedgerTokenCreatedAt" TIMESTAMP(3),
ADD COLUMN     "publicLedgerTokenHash" TEXT;

-- CreateTable
CREATE TABLE "SupplierDebtPayment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "aiReviewSummary" TEXT,
    "aiReviewOk" BOOLEAN,
    "aiReviewAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierDebtPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierDebtTransfer" (
    "id" TEXT NOT NULL,
    "debtPaymentId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "transferDate" TIMESTAMP(3) NOT NULL,
    "bankNameDestino" TEXT NOT NULL,
    "accountDestino" TEXT NOT NULL,
    "bankNameOrigen" TEXT NOT NULL,
    "accountOrigen" TEXT NOT NULL,
    "comprobanteNumber" TEXT NOT NULL,
    "transactionCost" DOUBLE PRECISION,
    "iva" DOUBLE PRECISION,
    "proofUrl" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierDebtTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierDebtPayment_code_key" ON "SupplierDebtPayment"("code");

-- CreateIndex
CREATE INDEX "SupplierDebtPayment_supplierId_idx" ON "SupplierDebtPayment"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierDebtPayment_closedAt_idx" ON "SupplierDebtPayment"("closedAt");

-- CreateIndex
CREATE INDEX "SupplierDebtTransfer_debtPaymentId_idx" ON "SupplierDebtTransfer"("debtPaymentId");

-- CreateIndex
CREATE INDEX "SupplierDebtTransfer_comprobanteNumber_idx" ON "SupplierDebtTransfer"("comprobanteNumber");

-- CreateIndex
CREATE INDEX "PurchaseRequest_debtPaymentId_idx" ON "PurchaseRequest"("debtPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_publicLedgerTokenHash_key" ON "Supplier"("publicLedgerTokenHash");

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_debtPaymentId_fkey" FOREIGN KEY ("debtPaymentId") REFERENCES "SupplierDebtPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDebtPayment" ADD CONSTRAINT "SupplierDebtPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDebtPayment" ADD CONSTRAINT "SupplierDebtPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDebtTransfer" ADD CONSTRAINT "SupplierDebtTransfer_debtPaymentId_fkey" FOREIGN KEY ("debtPaymentId") REFERENCES "SupplierDebtPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDebtTransfer" ADD CONSTRAINT "SupplierDebtTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

