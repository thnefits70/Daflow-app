-- Productos y cantidades por guía, leídos una vez del PDF (2026-10-02). Solo agrega.
ALTER TABLE "FulfillmentRequestGuide" ADD COLUMN     "labelCachedAt" TIMESTAMP(3),
ADD COLUMN     "labelProducts" JSONB,
ADD COLUMN     "manifestDay" TEXT;
