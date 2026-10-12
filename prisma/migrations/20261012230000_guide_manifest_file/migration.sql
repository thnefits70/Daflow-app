-- Pedido de Daniel 2026-10-12: de qué PDF (manifiesto) del batch vino cada guía.
ALTER TABLE "FulfillmentRequestGuide" ADD COLUMN "manifestFile" INTEGER;
