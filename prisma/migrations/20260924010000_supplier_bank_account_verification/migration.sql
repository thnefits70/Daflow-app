-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "bankAccountChangedAfterApprovalAt" TIMESTAMP(3),
ADD COLUMN     "bankAccountChangedAfterApprovalById" TEXT;

-- AlterTable
ALTER TABLE "SupplierBankAccount" ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- AddForeignKey
ALTER TABLE "SupplierBankAccount" ADD CONSTRAINT "SupplierBankAccount_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_bankAccountChangedAfterApprovalById_fkey" FOREIGN KEY ("bankAccountChangedAfterApprovalById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Las cuentas que ya existían se dan por verificadas si las agregó el admin
-- o si ya se usaron en alguna compra. Las que agregó otra persona y nunca se
-- usaron quedan por verificar.
UPDATE "SupplierBankAccount" a SET "verifiedAt" = a."createdAt"
WHERE a."createdById" IS NULL
   OR EXISTS (SELECT 1 FROM "PurchaseRequest" p WHERE p."bankAccountId" = a."id" OR p."carrierBankAccountId" = a."id");
