-- AlterEnum
ALTER TYPE "CeoBonusType" ADD VALUE 'PERSONALIZADO';

-- AlterTable
ALTER TABLE "CeoBonusGrant" ADD COLUMN     "amount" DOUBLE PRECISION,
ADD COLUMN     "targetPeriod" TEXT;

