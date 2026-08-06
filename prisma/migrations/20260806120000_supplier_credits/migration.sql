-- AlterTable: resolución del reporte urgente
ALTER TABLE "PurchaseRequestUrgentReport" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseRequestUrgentReport" ADD COLUMN "resolution" TEXT;

-- CreateEnum
CREATE TYPE "SupplierCreditStatus" AS ENUM ('AVAILABLE', 'APPLIED', 'REFUNDED');

-- CreateTable
CREATE TABLE "SupplierCredit" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "urgentReportId" TEXT,
    "status" "SupplierCreditStatus" NOT NULL DEFAULT 'AVAILABLE',
    "appliedToGroupId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "refundProofUrl" TEXT,
    "refundedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCredit_urgentReportId_key" ON "SupplierCredit"("urgentReportId");

-- CreateIndex
CREATE INDEX "SupplierCredit_supplierId_idx" ON "SupplierCredit"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierCredit_status_idx" ON "SupplierCredit"("status");

-- AddForeignKey
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_urgentReportId_fkey" FOREIGN KEY ("urgentReportId") REFERENCES "PurchaseRequestUrgentReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
