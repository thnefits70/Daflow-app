-- Guías retenidas por falta de stock en el corte (aprobado 2026-10-16).
CREATE TABLE "FulfillmentGuideHold" (
    "id" TEXT NOT NULL,
    "guideNumber" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "retainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retainedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,

    CONSTRAINT "FulfillmentGuideHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FulfillmentGuideHold_guideNumber_key" ON "FulfillmentGuideHold"("guideNumber");
CREATE INDEX "FulfillmentGuideHold_lotId_idx" ON "FulfillmentGuideHold"("lotId");
CREATE INDEX "FulfillmentGuideHold_releasedAt_idx" ON "FulfillmentGuideHold"("releasedAt");

-- Igual que las demás tablas: cerrada a la API REST pública (ver 2026-10-12).
ALTER TABLE "FulfillmentGuideHold" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "FulfillmentGuideHold" FROM anon, authenticated;
