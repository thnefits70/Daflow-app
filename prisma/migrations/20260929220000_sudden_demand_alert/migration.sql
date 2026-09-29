-- Producto que despierta (pedido de Daniel, sí del usuario 2026-09-29).
-- Solo agrega una tabla nueva; no toca nada existente.

-- CreateTable
CREATE TABLE "SuddenDemandAlert" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "baselineUnits" INTEGER NOT NULL,
    "dayUnits" INTEGER NOT NULL,
    "stockAtAlert" INTEGER NOT NULL,
    "note" TEXT,
    "noteById" TEXT,
    "noteByName" TEXT,
    "noteAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuddenDemandAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SuddenDemandAlert_day_idx" ON "SuddenDemandAlert"("day");

-- CreateIndex
CREATE UNIQUE INDEX "SuddenDemandAlert_catalogItemId_day_key" ON "SuddenDemandAlert"("catalogItemId", "day");

-- AddForeignKey
ALTER TABLE "SuddenDemandAlert" ADD CONSTRAINT "SuddenDemandAlert_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
