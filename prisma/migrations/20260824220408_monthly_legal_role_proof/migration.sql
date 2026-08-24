-- AlterTable
ALTER TABLE "MonthlyLegalRole" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "payoutProofName" TEXT,
ADD COLUMN     "payoutProofUrl" TEXT;

