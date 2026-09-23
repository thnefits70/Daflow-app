-- AlterTable
ALTER TABLE "FulfillmentRequestBatch" ADD COLUMN     "fileUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "manifestDate" TEXT;

-- CreateTable
CREATE TABLE "FulfillmentRequestGuide" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "guideNumber" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FulfillmentRequestGuide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DropiIgnoredCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DropiIgnoredCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentRequestGuide_guideNumber_key" ON "FulfillmentRequestGuide"("guideNumber");

-- CreateIndex
CREATE INDEX "FulfillmentRequestGuide_batchId_idx" ON "FulfillmentRequestGuide"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "DropiIgnoredCode_code_key" ON "DropiIgnoredCode"("code");

-- AddForeignKey
ALTER TABLE "FulfillmentRequestGuide" ADD CONSTRAINT "FulfillmentRequestGuide_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FulfillmentRequestBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

