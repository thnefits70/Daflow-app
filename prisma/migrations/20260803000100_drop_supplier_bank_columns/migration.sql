-- AlterTable: data already migrated into SupplierBankAccount
ALTER TABLE "Supplier" DROP COLUMN "bankName";
ALTER TABLE "Supplier" DROP COLUMN "bankAccountType";
ALTER TABLE "Supplier" DROP COLUMN "bankAccountNumber";
ALTER TABLE "Supplier" DROP COLUMN "bankAccountHolder";
