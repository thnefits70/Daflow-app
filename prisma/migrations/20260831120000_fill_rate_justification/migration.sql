
-- AlterTable
ALTER TABLE "WeeklyMetricRecord" ADD COLUMN     "fillRateJustification" TEXT,
ADD COLUMN     "fillRateJustificationAt" TIMESTAMP(3),
ADD COLUMN     "fillRateJustificationBy" TEXT;

