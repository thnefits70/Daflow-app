-- AlterTable
ALTER TABLE "PurchaseRequestReceipt" ADD COLUMN     "expirationDeclared" BOOLEAN,
ADD COLUMN     "lotExpirationDate" TIMESTAMP(3),
ADD COLUMN     "lotManufactureDate" TIMESTAMP(3),
ADD COLUMN     "lotQuantity" INTEGER;
