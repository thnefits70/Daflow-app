-- Seguimiento de tiendas (Análisis de Mercado) — aprobado por el usuario 2026-10-01.

-- AlterTable
ALTER TABLE "FulfillmentRequestGuide" ADD COLUMN     "sender" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "labelSender" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canLinkStoreProducts" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "StoreProductLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "linkedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreProductLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreProductLink_code_key" ON "StoreProductLink"("code");

-- CreateIndex
CREATE INDEX "StoreProductLink_storeId_idx" ON "StoreProductLink"("storeId");

-- AddForeignKey
ALTER TABLE "StoreProductLink" ADD CONSTRAINT "StoreProductLink_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreProductLink" ADD CONSTRAINT "StoreProductLink_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Datos iniciales (confirmado con el usuario 2026-10-01):
-- 1) Tienda Alonfe de Importadora Shanghai; en la etiqueta sale como "GUSTAVO URIBE".
INSERT INTO "Store" ("id", "name", "brand", "labelSender", "isActive", "order", "createdAt")
SELECT 'store_alonfe', 'ALONFE', 'Importadora Shanghai', 'GUSTAVO URIBE', true, COALESCE(MAX("order"), 0) + 1, CURRENT_TIMESTAMP FROM "Store";

-- 2) Yair Urgilez (asesor de Shanghai) es quien vincula.
UPDATE "User" SET "canLinkStoreProducts" = true WHERE "id" = 'cmrk1e8l60002b0vna4u0g8gs';

-- 3) Historial: los 89 PDF del 21–30/09 se revisaron y TODO producto de Shanghai
--    (y todo ID provisional "- ALF") salió con remitente GUSTAVO URIBE.
INSERT INTO "StoreProductLink" ("id", "code", "name", "storeId", "source", "createdAt")
SELECT 'spl_' || md5(c."justCode"), c."justCode", c."name", 'store_alonfe', 'HISTORY', CURRENT_TIMESTAMP
FROM "PurchaseCatalogItem" c
WHERE c."bodega" = 'MKT_SHANGHAI' AND c."justCode" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "FulfillmentRequestGuide" g WHERE c."justCode" = ANY (g."codes"))
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "StoreProductLink" ("id", "code", "name", "storeId", "source", "createdAt")
SELECT DISTINCT ON (p."code") 'spl_' || md5(p."code"), p."code", p."name", 'store_alonfe', 'HISTORY', CURRENT_TIMESTAMP
FROM "FulfillmentProvisionalLine" p
WHERE p."name" ~* '-\s*ALF\s*$'
ORDER BY p."code"
ON CONFLICT ("code") DO NOTHING;
