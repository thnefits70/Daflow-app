-- AlterTable
ALTER TABLE "PurchaseRequestUrgentReport" ADD COLUMN     "expirationDeclared" BOOLEAN,
ADD COLUMN     "lotDeclaredAt" TIMESTAMP(3),
ADD COLUMN     "lotDeclaredById" TEXT,
ADD COLUMN     "lotExpirationDate" TIMESTAMP(3),
ADD COLUMN     "lotManufactureDate" TIMESTAMP(3);
