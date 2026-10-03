-- AlterTable
ALTER TABLE "PurchaseCatalogItem" ADD COLUMN     "dropiPriceRef" DOUBLE PRECISION,
ADD COLUMN     "dropiPriceRefAt" TIMESTAMP(3),
ADD COLUMN     "dropiPriceRefById" TEXT;
