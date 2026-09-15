-- CreateEnum
CREATE TYPE "FacturaSolicitud" AS ENUM ('SI', 'NO', 'PENDIENTE');

-- AlterTable
ALTER TABLE "ExternalSale" ADD COLUMN "facturaSolicitada" "FacturaSolicitud" NOT NULL DEFAULT 'PENDIENTE';
