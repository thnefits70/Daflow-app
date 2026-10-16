-- CreateTable
CREATE TABLE "RocketWarranty" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "status" TEXT NOT NULL,
    "originalGuide" TEXT NOT NULL,
    "originalShippedAt" TIMESTAMP(3) NOT NULL,
    "clientName" TEXT,
    "city" TEXT,
    "items" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "evidenceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dropiOrder" TEXT NOT NULL,
    "guideNumber" TEXT,
    "guideLinkedAt" TIMESTAMP(3),
    "guideLinkedBy" TEXT,
    "dropiAccount" TEXT,
    "nickCheckedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "shippedBatchId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "RocketWarranty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RocketWarranty_number_key" ON "RocketWarranty"("number");
CREATE INDEX "RocketWarranty_status_idx" ON "RocketWarranty"("status");
CREATE INDEX "RocketWarranty_dropiOrder_idx" ON "RocketWarranty"("dropiOrder");
CREATE INDEX "RocketWarranty_guideNumber_idx" ON "RocketWarranty"("guideNumber");
CREATE INDEX "RocketWarranty_originalGuide_idx" ON "RocketWarranty"("originalGuide");

-- La API REST de Supabase está cerrada (2026-10-12): RLS sin políticas.
ALTER TABLE "RocketWarranty" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "RocketWarranty" FROM anon, authenticated;
