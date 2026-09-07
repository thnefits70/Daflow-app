-- AlterEnum
ALTER TYPE "PersonalPurchaseStatus" ADD VALUE 'PENDING_CASH_CONFIRM';

-- AlterEnum
ALTER TYPE "PersonalPurchasePaymentMethod" ADD VALUE 'CASH';

-- AlterTable
ALTER TABLE "PersonalPurchaseOrder" ADD COLUMN     "cashConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "cashConfirmedById" TEXT,
ADD COLUMN     "cashPettyCashEntryId" TEXT;
