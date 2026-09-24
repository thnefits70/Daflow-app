-- AlterTable
ALTER TABLE "SupplierSheetTab" ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SupplierSheetEmail" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "canWrite" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessAt" TIMESTAMP(3),

    CONSTRAINT "SupplierSheetEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierSheetLoginCode" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierSheetLoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierSheetSession" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierSheetSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierSheetEmail_supplierId_email_key" ON "SupplierSheetEmail"("supplierId", "email");

-- CreateIndex
CREATE INDEX "SupplierSheetLoginCode_emailId_idx" ON "SupplierSheetLoginCode"("emailId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierSheetSession_tokenHash_key" ON "SupplierSheetSession"("tokenHash");

-- CreateIndex
CREATE INDEX "SupplierSheetSession_emailId_idx" ON "SupplierSheetSession"("emailId");

-- AddForeignKey
ALTER TABLE "SupplierSheetEmail" ADD CONSTRAINT "SupplierSheetEmail_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierSheetLoginCode" ADD CONSTRAINT "SupplierSheetLoginCode_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "SupplierSheetEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierSheetSession" ADD CONSTRAINT "SupplierSheetSession_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "SupplierSheetEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

