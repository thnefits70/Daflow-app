-- Reingreso: unidades que no regresaron en la devolución (2026-10-03). Solo agrega.

-- AlterTable
ALTER TABLE "MerchandiseReentryItem" ADD COLUMN     "missingQty" INTEGER NOT NULL DEFAULT 0;
