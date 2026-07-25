-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "isMissionVision" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Document_isMissionVision_idx" ON "Document"("isMissionVision");
