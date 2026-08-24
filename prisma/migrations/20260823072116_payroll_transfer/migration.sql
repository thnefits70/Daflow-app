-- CreateEnum
CREATE TYPE "PayrollTransferStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PayrollTransferDestination" AS ENUM ('NAIROBY', 'ADMIN_PRODUBANCO');

-- CreateTable
CREATE TABLE "PayrollTransfer" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "destination" "PayrollTransferDestination" NOT NULL,
    "status" "PayrollTransferStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "rejectionReason" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "proofUrl" TEXT,
    "proofName" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPayrollBankAccount" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "bankName" TEXT,
    "bankAccountType" TEXT,
    "bankAccountNumber" TEXT,
    "bankAccountHolder" TEXT,
    "holderIdType" "HolderIdType",
    "holderIdNumber" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminPayrollBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollTransfer_periodId_key" ON "PayrollTransfer"("periodId");

-- CreateIndex
CREATE INDEX "PayrollTransfer_status_idx" ON "PayrollTransfer"("status");

-- AddForeignKey
ALTER TABLE "PayrollTransfer" ADD CONSTRAINT "PayrollTransfer_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
