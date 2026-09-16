-- AlterTable
ALTER TABLE "PurchaseCatalogItem" ADD COLUMN     "bodega" "MarketProductBodega";

-- AlterTable
ALTER TABLE "DropiCombo" ADD COLUMN     "bodega" "MarketProductBodega";

-- Backfill: donde el producto ya pasó por Análisis de Mercado y tiene una
-- bodega elegida ahí, se copia como punto de partida en el catálogo, para
-- no tener que volver a preguntarla.
UPDATE "PurchaseCatalogItem" AS pci
SET "bodega" = mpp."bodega"
FROM "MarketProductProposal" AS mpp
WHERE mpp."catalogItemId" = pci."id"
  AND mpp."bodega" IS NOT NULL;
