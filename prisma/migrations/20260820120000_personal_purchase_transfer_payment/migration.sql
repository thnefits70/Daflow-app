-- CreateEnum
CREATE TYPE "PersonalPurchasePaymentMethod" AS ENUM ('PAYROLL', 'TRANSFER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PersonalPurchaseStatus" ADD VALUE 'PENDING_PAYMENT_METHOD';
ALTER TYPE "PersonalPurchaseStatus" ADD VALUE 'PENDING_TRANSFER_PROOF';
ALTER TYPE "PersonalPurchaseStatus" ADD VALUE 'PENDING_ADMIN_CONFIRM';
ALTER TYPE "PersonalPurchaseStatus" ADD VALUE 'PENDING_NAIROBY_CLOSE';

-- AlterTable
ALTER TABLE "PersonalPurchaseOrder" ADD COLUMN     "paymentMethod" "PersonalPurchasePaymentMethod",
ADD COLUMN     "pickedUpApprovedById" TEXT,
ADD COLUMN     "transferAdminConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "transferAdminConfirmedById" TEXT,
ADD COLUMN     "transferAiMatch" BOOLEAN,
ADD COLUMN     "transferAiNote" TEXT,
ADD COLUMN     "transferAiReadAmount" DOUBLE PRECISION,
ADD COLUMN     "transferClosedAt" TIMESTAMP(3),
ADD COLUMN     "transferClosedById" TEXT,
ADD COLUMN     "transferDeadlineAt" TIMESTAMP(3),
ADD COLUMN     "transferProofName" TEXT,
ADD COLUMN     "transferProofUploadedAt" TIMESTAMP(3),
ADD COLUMN     "transferProofUrl" TEXT;

-- CreateTable
CREATE TABLE "CompanyBankAccount" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "bankName" TEXT,
    "bankAccountType" TEXT,
    "bankAccountNumber" TEXT,
    "bankAccountHolder" TEXT,
    "holderIdType" "HolderIdType",
    "holderIdNumber" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyBankAccount_pkey" PRIMARY KEY ("id")
);

