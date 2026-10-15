-- Arreglos de garantía (2026-10-15): reenvío pagado por el dropshipper y
-- arreglo en dinero con el cliente.
CREATE TABLE "WarrantyArrangement" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "originalGuide" TEXT NOT NULL,
    "clientName" TEXT,
    "city" TEXT,
    "reason" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "orderNumber" TEXT,
    "freightAmount" DOUBLE PRECISION,
    "paymentMethod" TEXT,
    "guideNumber" TEXT,
    "guideAttachedAt" TIMESTAMP(3),
    "guideAttachedById" TEXT,
    "catalogItemId" TEXT,
    "productName" TEXT,
    "amount" DOUBLE PRECISION,
    "holderName" TEXT,
    "holderIdNumber" TEXT,
    "bankName" TEXT,
    "bankAccountType" TEXT,
    "bankAccountNumber" TEXT,
    "payoutProofUrl" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    CONSTRAINT "WarrantyArrangement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WarrantyArrangement_number_key" ON "WarrantyArrangement"("number");
CREATE INDEX "WarrantyArrangement_status_idx" ON "WarrantyArrangement"("status");
CREATE INDEX "WarrantyArrangement_kind_createdAt_idx" ON "WarrantyArrangement"("kind", "createdAt");
ALTER TABLE "WarrantyArrangement" ENABLE ROW LEVEL SECURITY;
