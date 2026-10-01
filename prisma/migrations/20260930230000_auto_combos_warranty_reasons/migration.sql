-- Pedido del usuario 2026-09-30: combos automáticos (2-3 productos, nombre,
-- marca, precio aprobado, huella única, conexión con Stock Actual y brandeo)
-- + motivo de garantía en el corte.
-- OJO: a propósito NO se tocan las columnas de NewIdBranding/User del
-- trabajo de Robert que está en espera (dropiPublicAt, realDrive*, realDropi*,
-- notifyNewIdRealPhotos) — existen en la base pero no en el schema.

-- CreateEnum
CREATE TYPE "ComboSuggestionItemRole" AS ENUM ('WINNER', 'LOW');

-- DropIndex
DROP INDEX "ComboSuggestion_winnerCatalogItemId_lowRotationCatalogItemI_key";

-- AlterTable
ALTER TABLE "ComboSuggestion" ADD COLUMN     "approvedDropiPrice" DOUBLE PRECISION,
ADD COLUMN     "bodega" "MarketProductBodega",
ADD COLUMN     "dropiComboId" TEXT,
ADD COLUMN     "fingerprint" TEXT,
ADD COLUMN     "suggestedName" TEXT;

-- AlterTable
ALTER TABLE "FulfillmentRequestItem" ADD COLUMN     "warrantyCategoryId" TEXT;

-- AlterTable
ALTER TABLE "NewIdBranding" ADD COLUMN     "dropiComboId" TEXT;

-- CreateTable
CREATE TABLE "ComboSuggestionItem" (
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "role" "ComboSuggestionItemRole" NOT NULL,
    "fromComboCode" TEXT,

    CONSTRAINT "ComboSuggestionItem_pkey" PRIMARY KEY ("id")
);

-- Backfill: las sugerencias que ya existen pasan a la lista nueva con 1
-- unidad de cada uno, y reciben su huella (ids ordenados, ×1).
INSERT INTO "ComboSuggestionItem" ("id", "suggestionId", "catalogItemId", "quantity", "role")
SELECT 'csi_w_' || "id", "id", "winnerCatalogItemId", 1, 'WINNER' FROM "ComboSuggestion";
INSERT INTO "ComboSuggestionItem" ("id", "suggestionId", "catalogItemId", "quantity", "role")
SELECT 'csi_l_' || "id", "id", "lowRotationCatalogItemId", 1, 'LOW' FROM "ComboSuggestion";
UPDATE "ComboSuggestion" SET "fingerprint" =
  LEAST("winnerCatalogItemId", "lowRotationCatalogItemId") || 'x1|' || GREATEST("winnerCatalogItemId", "lowRotationCatalogItemId") || 'x1';

-- CreateIndex
CREATE INDEX "ComboSuggestionItem_suggestionId_idx" ON "ComboSuggestionItem"("suggestionId");

-- CreateIndex
CREATE INDEX "ComboSuggestionItem_catalogItemId_idx" ON "ComboSuggestionItem"("catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ComboSuggestion_fingerprint_key" ON "ComboSuggestion"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ComboSuggestion_dropiComboId_key" ON "ComboSuggestion"("dropiComboId");

-- CreateIndex
CREATE INDEX "ComboSuggestion_winnerCatalogItemId_lowRotationCatalogItemI_idx" ON "ComboSuggestion"("winnerCatalogItemId", "lowRotationCatalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "NewIdBranding_dropiComboId_key" ON "NewIdBranding"("dropiComboId");

-- AddForeignKey
ALTER TABLE "ComboSuggestion" ADD CONSTRAINT "ComboSuggestion_dropiComboId_fkey" FOREIGN KEY ("dropiComboId") REFERENCES "DropiCombo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboSuggestionItem" ADD CONSTRAINT "ComboSuggestionItem_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "ComboSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboSuggestionItem" ADD CONSTRAINT "ComboSuggestionItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentRequestItem" ADD CONSTRAINT "FulfillmentRequestItem_warrantyCategoryId_fkey" FOREIGN KEY ("warrantyCategoryId") REFERENCES "WarrantyCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewIdBranding" ADD CONSTRAINT "NewIdBranding_dropiComboId_fkey" FOREIGN KEY ("dropiComboId") REFERENCES "DropiCombo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
