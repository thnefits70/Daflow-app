-- El admin puede pedir con un clic que quien solicitó una compra cambie la
-- cuenta bancaria del proveedor elegida, cuando esa cuenta falla al pagar.

ALTER TABLE "PurchaseRequest" ADD COLUMN "bankAccountChangeRequestedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseRequest" ADD COLUMN "bankAccountChangeNote" TEXT;
ALTER TABLE "PurchaseRequest" ADD COLUMN "bankAccountChangeRequestedById" TEXT;

ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_bankAccountChangeRequestedById_fkey" FOREIGN KEY ("bankAccountChangeRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
