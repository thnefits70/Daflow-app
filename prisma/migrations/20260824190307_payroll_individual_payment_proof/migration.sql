-- AlterTable
ALTER TABLE "PayrollQuincenaRole" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paidProofName" TEXT,
ADD COLUMN     "paidProofReadAmount" DOUBLE PRECISION,
ADD COLUMN     "paidProofUrl" TEXT;

