-- Brandeo se registra por pasos (hecho fuera de DAFLOW), sin fotos ni videos.
ALTER TABLE "NewIdBranding" DROP COLUMN "photos",
DROP COLUMN "videoUrls",
ADD COLUMN "dropiImagesAt" TIMESTAMP(3),
ADD COLUMN "dropiImagesById" TEXT,
ADD COLUMN "dropiInfoAt" TIMESTAMP(3),
ADD COLUMN "dropiInfoById" TEXT,
ADD COLUMN "driveVideoAt" TIMESTAMP(3),
ADD COLUMN "driveVideoById" TEXT;
