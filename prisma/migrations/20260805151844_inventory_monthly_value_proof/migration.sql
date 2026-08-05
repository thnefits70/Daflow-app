-- AlterTable
ALTER TABLE "FinanceSharedMonthlyBalance" ADD COLUMN     "inventarioAiMatches" BOOLEAN,
ADD COLUMN     "inventarioAiReadAmount" DOUBLE PRECISION,
ADD COLUMN     "inventarioProofUrl" TEXT;
