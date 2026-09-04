
-- AlterTable
ALTER TABLE "CancelledGuideReport" ADD COLUMN     "fulfillmentRemovedAt" TIMESTAMP(3),
ADD COLUMN     "fulfillmentRemovedById" TEXT;

-- CreateIndex
CREATE INDEX "CancelledGuideReport_fulfillmentRemovedAt_idx" ON "CancelledGuideReport"("fulfillmentRemovedAt");

-- AddForeignKey
ALTER TABLE "CancelledGuideReport" ADD CONSTRAINT "CancelledGuideReport_fulfillmentRemovedById_fkey" FOREIGN KEY ("fulfillmentRemovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

