-- Dos flags de delegación (patrón canManagePurchases) + tabla de
-- confirmaciones para "Mercadería recibida" (Análisis de Mercado).

ALTER TABLE "User" ADD COLUMN "canConfirmMarketingDesign" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "canConfirmMarketingAdvisor" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PurchaseReceiptFollowUp" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "designConfirmedAt" TIMESTAMP(3),
    "designConfirmedById" TEXT,
    "advisorConfirmedAt" TIMESTAMP(3),
    "advisorConfirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReceiptFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseReceiptFollowUp_requestId_key" ON "PurchaseReceiptFollowUp"("requestId");

ALTER TABLE "PurchaseReceiptFollowUp" ADD CONSTRAINT "PurchaseReceiptFollowUp_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptFollowUp" ADD CONSTRAINT "PurchaseReceiptFollowUp_designConfirmedById_fkey" FOREIGN KEY ("designConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptFollowUp" ADD CONSTRAINT "PurchaseReceiptFollowUp_advisorConfirmedById_fkey" FOREIGN KEY ("advisorConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
