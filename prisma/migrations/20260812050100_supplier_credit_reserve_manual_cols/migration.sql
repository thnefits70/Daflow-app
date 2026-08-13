ALTER TABLE "SupplierCredit" ADD COLUMN "proofUrl" TEXT;
ALTER TABLE "SupplierCredit" ADD COLUMN "proofName" TEXT;
ALTER TABLE "SupplierCredit" ADD COLUMN "reservedForGroupId" TEXT;
ALTER TABLE "SupplierCredit" ADD COLUMN "reservedAt" TIMESTAMP(3);
CREATE INDEX "SupplierCredit_reservedForGroupId_idx" ON "SupplierCredit"("reservedForGroupId");
