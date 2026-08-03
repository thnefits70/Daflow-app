-- CreateTable
CREATE TABLE "SupplierBankAccount" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankAccountType" TEXT NOT NULL,
    "bankAccountNumber" TEXT NOT NULL,
    "bankAccountHolder" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierBankAccount_supplierId_idx" ON "SupplierBankAccount"("supplierId");

-- AddForeignKey
ALTER TABLE "SupplierBankAccount" ADD CONSTRAINT "SupplierBankAccount_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBankAccount" ADD CONSTRAINT "SupplierBankAccount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: which bank account a purchase request pays to
ALTER TABLE "PurchaseRequest" ADD COLUMN "bankAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "SupplierBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
