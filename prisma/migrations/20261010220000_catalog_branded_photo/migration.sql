-- AlterTable
ALTER TABLE "PurchaseCatalogItem" ADD COLUMN "brandedPhotoUrl" TEXT,
ADD COLUMN "brandedPhotoAt" TIMESTAMP(3),
ADD COLUMN "brandedPhotoById" TEXT;

-- AlterTable
ALTER TABLE "DropiCombo" ADD COLUMN "brandedPhotoUrl" TEXT,
ADD COLUMN "brandedPhotoAt" TIMESTAMP(3),
ADD COLUMN "brandedPhotoById" TEXT;
