-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "isEmergency" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emergencyReason" TEXT;
