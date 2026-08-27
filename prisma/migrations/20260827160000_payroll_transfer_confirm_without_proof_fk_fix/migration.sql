-- DropForeignKey
ALTER TABLE "PayrollIessTransfer" DROP CONSTRAINT "PayrollIessTransfer_confirmedWithoutProofById_fkey";

-- DropForeignKey
ALTER TABLE "PayrollTransfer" DROP CONSTRAINT "PayrollTransfer_confirmedWithoutProofById_fkey";

-- AlterTable
ALTER TABLE "PayrollIessTransfer" DROP COLUMN "confirmedWithoutProofById",
ADD COLUMN     "confirmedWithoutProofByName" TEXT;

-- AlterTable
ALTER TABLE "PayrollTransfer" DROP COLUMN "confirmedWithoutProofById",
ADD COLUMN     "confirmedWithoutProofByName" TEXT;

