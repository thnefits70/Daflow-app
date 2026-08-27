-- AlterTable
ALTER TABLE "PayrollIessTransfer" ADD COLUMN     "confirmedWithoutProof" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "confirmedWithoutProofAt" TIMESTAMP(3),
ADD COLUMN     "confirmedWithoutProofById" TEXT,
ADD COLUMN     "confirmedWithoutProofNote" TEXT;

-- AlterTable
ALTER TABLE "PayrollTransfer" ADD COLUMN     "confirmedWithoutProof" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "confirmedWithoutProofAt" TIMESTAMP(3),
ADD COLUMN     "confirmedWithoutProofById" TEXT,
ADD COLUMN     "confirmedWithoutProofNote" TEXT;

-- AddForeignKey
ALTER TABLE "PayrollTransfer" ADD CONSTRAINT "PayrollTransfer_confirmedWithoutProofById_fkey" FOREIGN KEY ("confirmedWithoutProofById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollIessTransfer" ADD CONSTRAINT "PayrollIessTransfer_confirmedWithoutProofById_fkey" FOREIGN KEY ("confirmedWithoutProofById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

