-- Pedido del usuario 2026-09-30: producto pequeño ($0.50) o normal ($0.75) para el fulfillment.
ALTER TABLE "PurchaseCatalogItem" ADD COLUMN     "fulfillmentSize" TEXT,
ADD COLUMN     "fulfillmentSizeSetAt" TIMESTAMP(3),
ADD COLUMN     "fulfillmentSizeSetById" TEXT;
