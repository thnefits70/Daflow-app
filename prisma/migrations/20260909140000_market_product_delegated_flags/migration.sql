-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canBrandMarketProduct" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canPublishMarketProduct" BOOLEAN NOT NULL DEFAULT false;

