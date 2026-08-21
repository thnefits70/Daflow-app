
-- AlterTable
ALTER TABLE "MerchandiseReentryItem" ADD COLUMN     "damageSolutionNote" TEXT,
ADD COLUMN     "damageSolved" BOOLEAN,
ADD COLUMN     "damageSolvedAt" TIMESTAMP(3),
ADD COLUMN     "damageSolvedById" TEXT,
ADD COLUMN     "disposalDecidedAt" TIMESTAMP(3),
ADD COLUMN     "disposalDecidedById" TEXT,
ADD COLUMN     "disposalDecision" BOOLEAN,
ADD COLUMN     "weeklyWriteOffBatchId" TEXT;

-- CreateTable
CREATE TABLE "MerchandiseWeeklyWriteOffBatch" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "justWrittenOffAt" TIMESTAMP(3),
    "justWrittenOffById" TEXT,
    "nairobyConfirmedAt" TIMESTAMP(3),
    "nairobyConfirmedById" TEXT,

    CONSTRAINT "MerchandiseWeeklyWriteOffBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MerchandiseWeeklyWriteOffBatch_justWrittenOffAt_idx" ON "MerchandiseWeeklyWriteOffBatch"("justWrittenOffAt");

-- CreateIndex
CREATE INDEX "MerchandiseWeeklyWriteOffBatch_nairobyConfirmedAt_idx" ON "MerchandiseWeeklyWriteOffBatch"("nairobyConfirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MerchandiseWeeklyWriteOffBatch_weekStart_key" ON "MerchandiseWeeklyWriteOffBatch"("weekStart");

-- AddForeignKey
ALTER TABLE "MerchandiseReentryItem" ADD CONSTRAINT "MerchandiseReentryItem_damageSolvedById_fkey" FOREIGN KEY ("damageSolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseReentryItem" ADD CONSTRAINT "MerchandiseReentryItem_weeklyWriteOffBatchId_fkey" FOREIGN KEY ("weeklyWriteOffBatchId") REFERENCES "MerchandiseWeeklyWriteOffBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseReentryItem" ADD CONSTRAINT "MerchandiseReentryItem_disposalDecidedById_fkey" FOREIGN KEY ("disposalDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseWeeklyWriteOffBatch" ADD CONSTRAINT "MerchandiseWeeklyWriteOffBatch_justWrittenOffById_fkey" FOREIGN KEY ("justWrittenOffById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseWeeklyWriteOffBatch" ADD CONSTRAINT "MerchandiseWeeklyWriteOffBatch_nairobyConfirmedById_fkey" FOREIGN KEY ("nairobyConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

