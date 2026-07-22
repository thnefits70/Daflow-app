-- DropIndex
DROP INDEX "MonthlyRecognitionPopupSeen_viewerId_month_key";

-- AlterTable
ALTER TABLE "MonthlyRecognitionPopupSeen" ADD COLUMN     "rank" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyRecognitionPopupSeen_viewerId_month_rank_key" ON "MonthlyRecognitionPopupSeen"("viewerId", "month", "rank");
