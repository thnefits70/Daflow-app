-- AlterTable
ALTER TABLE "PurchasePriceCorrection" ADD COLUMN     "proofAiCheck" JSONB,
ADD COLUMN     "proofHash" TEXT,
ADD COLUMN     "proofMismatchNote" TEXT;

-- CreateIndex
CREATE INDEX "PurchasePriceCorrection_proofHash_idx" ON "PurchasePriceCorrection"("proofHash");
