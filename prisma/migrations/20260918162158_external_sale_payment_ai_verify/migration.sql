-- AlterTable
ALTER TABLE "ExternalSale" ADD COLUMN     "paymentOverrideNote" TEXT,
ADD COLUMN     "paymentProofAiMatches" BOOLEAN,
ADD COLUMN     "paymentProofAiReadAmount" DOUBLE PRECISION;

