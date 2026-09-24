-- AlterTable
ALTER TABLE "ExternalSale" ADD COLUMN "closeDifferenceNote" TEXT,
ADD COLUMN "closeDifferenceReason" TEXT,
ADD COLUMN "closeReceivedAmount" DOUBLE PRECISION;
