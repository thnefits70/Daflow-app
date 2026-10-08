-- CreateEnum
CREATE TYPE "LooseInvoiceReason" AS ENUM ('PREVIOUS_PURCHASE', 'GENERAL_SUPPORT', 'OTHER');

-- CreateTable
CREATE TABLE "LooseInvoice" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "docUrl" TEXT NOT NULL,
    "reason" "LooseInvoiceReason" NOT NULL,
    "relatedGroupId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "LooseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LooseInvoice_supplierId_idx" ON "LooseInvoice"("supplierId");

-- CreateIndex
CREATE INDEX "LooseInvoice_invoiceDate_idx" ON "LooseInvoice"("invoiceDate");

-- AddForeignKey
ALTER TABLE "LooseInvoice" ADD CONSTRAINT "LooseInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LooseInvoice" ADD CONSTRAINT "LooseInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LooseInvoice" ADD CONSTRAINT "LooseInvoice_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
