-- AlterTable
ALTER TABLE "StockCountLine" ADD COLUMN     "durationSec" INTEGER;

-- CreateTable
CREATE TABLE "StockCountAssignment" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "catalogItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assigneeId" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lateNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "StockCountAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockCountAssignment_countId_idx" ON "StockCountAssignment"("countId");

-- CreateIndex
CREATE INDEX "StockCountAssignment_assigneeId_idx" ON "StockCountAssignment"("assigneeId");

-- AddForeignKey
ALTER TABLE "StockCountAssignment" ADD CONSTRAINT "StockCountAssignment_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

