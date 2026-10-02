-- Reingreso por escaneo de guía de devolución (2026-10-02). Solo agrega.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isReentryResponsible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MerchandiseReentryItem" ADD COLUMN     "guideId" TEXT,
ADD COLUMN     "manualReason" TEXT,
ADD COLUMN     "scanDamage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unitCost" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "MerchandiseReentryGuide" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "guideNumber" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "shippedDay" TEXT,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchandiseReentryGuide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchandiseReentryGuide_guideNumber_key" ON "MerchandiseReentryGuide"("guideNumber");

-- CreateIndex
CREATE INDEX "MerchandiseReentryGuide_batchId_idx" ON "MerchandiseReentryGuide"("batchId");

-- CreateIndex
CREATE INDEX "MerchandiseReentryItem_guideId_idx" ON "MerchandiseReentryItem"("guideId");

-- AddForeignKey
ALTER TABLE "MerchandiseReentryItem" ADD CONSTRAINT "MerchandiseReentryItem_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "MerchandiseReentryGuide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseReentryGuide" ADD CONSTRAINT "MerchandiseReentryGuide_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MerchandiseReentryBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Empieza Joel como responsable del reingreso (pedido del usuario).
UPDATE "User" SET "isReentryResponsible" = true WHERE "username" = 'joelguale2026';
