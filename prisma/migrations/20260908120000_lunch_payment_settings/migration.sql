-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canRegisterLunchPayments" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LunchPaymentSettings" (
    "id" TEXT NOT NULL,
    "pricePerLunch" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "LunchPaymentSettings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "LunchPaymentSettings" ADD CONSTRAINT "LunchPaymentSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
