-- Confirmado 2026-09-01, pedido explícito del usuario: una venta externa
-- puede declarar varios productos bajo la misma modalidad (mismo cliente,
-- mismo pago, misma entrega). Bryan puede rechazar un producto puntual sin
-- tumbar toda la venta.

-- CreateTable
CREATE TABLE "ExternalSaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "declaredProductName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalSaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalSaleItem_saleId_idx" ON "ExternalSaleItem"("saleId");

-- AddForeignKey
ALTER TABLE "ExternalSaleItem" ADD CONSTRAINT "ExternalSaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "ExternalSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSaleItem" ADD CONSTRAINT "ExternalSaleItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrar cada venta ya declarada (hasta ahora, un solo producto por venta)
-- a un renglón de ExternalSaleItem, antes de borrar las columnas viejas.
INSERT INTO "ExternalSaleItem" ("id", "saleId", "catalogItemId", "declaredProductName", "quantity", "unitPrice", "totalAmount", "createdAt")
SELECT gen_random_uuid()::text, "id", "catalogItemId", "declaredProductName", "quantity", "unitPrice", "totalAmount", "createdAt"
FROM "ExternalSale";

-- DropForeignKey
ALTER TABLE "ExternalSale" DROP CONSTRAINT "ExternalSale_catalogItemId_fkey";

-- AlterTable (totalAmount se queda: ya era la suma correcta con un renglón)
ALTER TABLE "ExternalSale" DROP COLUMN "catalogItemId",
DROP COLUMN "declaredProductName",
DROP COLUMN "quantity",
DROP COLUMN "unitPrice";
