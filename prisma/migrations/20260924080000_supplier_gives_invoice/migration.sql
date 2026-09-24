-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "givesInvoice" BOOLEAN,
ADD COLUMN "givesInvoiceSetAt" TIMESTAMP(3),
ADD COLUMN "givesInvoiceSetBy" TEXT;
