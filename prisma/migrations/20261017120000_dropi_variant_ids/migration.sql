-- Variantes organizadas como en Dropi (pedido de DANIEL 2026-10-17).
-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "dropiVariantId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseCatalogItem" ADD COLUMN     "variantsOrganizedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StockPhysicalCountAdjustmentRequest" ADD COLUMN     "organizeVariants" BOOLEAN NOT NULL DEFAULT false;
