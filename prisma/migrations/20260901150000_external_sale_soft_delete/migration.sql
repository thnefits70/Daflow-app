-- AlterTable
ALTER TABLE "ExternalSale" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;
