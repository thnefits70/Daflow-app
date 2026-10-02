
-- CreateEnum
CREATE TYPE "ExternalSaleKind" AS ENUM ('SALE', 'WARRANTY');

-- CreateEnum
CREATE TYPE "WarrantyReason" AS ENUM ('MAL_FUNCIONAMIENTO', 'PRODUCTO_ROTO', 'ORDEN_INCOMPLETA', 'ORDEN_DIFERENTE', 'ENVIADO_DE_MAS');

-- CreateEnum
CREATE TYPE "WarrantyItemRole" AS ENUM ('DELIVER', 'PICKUP', 'UNRECOVERED');

-- AlterTable
ALTER TABLE "ExternalSale" ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryCity" TEXT,
ADD COLUMN     "deliveryNotes" TEXT,
ADD COLUMN     "kind" "ExternalSaleKind" NOT NULL DEFAULT 'SALE',
ADD COLUMN     "warrantyEvidenceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "warrantyLate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "warrantyNumber" INTEGER,
ADD COLUMN     "warrantyOriginalCharge" DOUBLE PRECISION,
ADD COLUMN     "warrantyOriginalShippedAt" TIMESTAMP(3),
ADD COLUMN     "warrantySourceCarrier" TEXT,
ADD COLUMN     "warrantySourceGuide" TEXT,
ADD COLUMN     "warrantySourceSaleId" TEXT;

-- AlterTable
ALTER TABLE "ExternalSaleItem" ADD COLUMN     "discountsStock" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pickupReceivedAt" TIMESTAMP(3),
ADD COLUMN     "pickupReceivedById" TEXT,
ADD COLUMN     "warrantyReason" "WarrantyReason",
ADD COLUMN     "warrantyRole" "WarrantyItemRole";

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "lastLocalWarrantyNumber" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSale_warrantyNumber_key" ON "ExternalSale"("warrantyNumber");

-- CreateIndex
CREATE INDEX "ExternalSale_warrantySourceGuide_idx" ON "ExternalSale"("warrantySourceGuide");

-- CreateIndex
CREATE INDEX "ExternalSale_warrantySourceSaleId_idx" ON "ExternalSale"("warrantySourceSaleId");

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_warrantySourceSaleId_fkey" FOREIGN KEY ("warrantySourceSaleId") REFERENCES "ExternalSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSaleItem" ADD CONSTRAINT "ExternalSaleItem_pickupReceivedById_fkey" FOREIGN KEY ("pickupReceivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

