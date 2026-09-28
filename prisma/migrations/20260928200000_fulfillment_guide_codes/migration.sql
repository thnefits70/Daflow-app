-- Pedido de Daniel 2026-09-28: productos de cada guía, para contar guías por marca y transportadora.
ALTER TABLE "FulfillmentRequestGuide" ADD COLUMN "codes" TEXT[] DEFAULT ARRAY[]::TEXT[];
