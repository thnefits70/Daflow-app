-- Interruptor: respaldo de Daniel para subir los PDF del corte de Fulfillment (2026-10-05). Solo agrega.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canUploadFulfillmentGuides" BOOLEAN NOT NULL DEFAULT false;
