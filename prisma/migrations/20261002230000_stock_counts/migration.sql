-- CreateEnum
CREATE TYPE "StockCountKind" AS ENUM ('FULL', 'WEEKLY_AREA');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('COUNTING', 'SUBMITTED', 'APPROVED');

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "fullStockCountCompletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "kind" "StockCountKind" NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'COUNTING',
    "area" TEXT,
    "weekStart" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "countedQty" INTEGER NOT NULL,
    "countedById" TEXT,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedQty" INTEGER NOT NULL,
    "decision" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockCount_status_idx" ON "StockCount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_kind_weekStart_area_key" ON "StockCount"("kind", "weekStart", "area");

-- CreateIndex
CREATE INDEX "StockCountLine_countId_idx" ON "StockCountLine"("countId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_countId_catalogItemId_key" ON "StockCountLine"("countId", "catalogItemId");

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

