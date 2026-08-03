-- CreateEnum
CREATE TYPE "HolderIdType" AS ENUM ('RUC', 'CEDULA');

-- AlterTable
ALTER TABLE "SupplierBankAccount" ADD COLUMN "holderIdType" "HolderIdType";
ALTER TABLE "SupplierBankAccount" ADD COLUMN "holderIdNumber" TEXT;
