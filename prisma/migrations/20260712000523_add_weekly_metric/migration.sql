-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "trackWeeklyMetric" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WeeklyMetricRecord" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "week" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyMetricRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyMetricRecord_deptId_idx" ON "WeeklyMetricRecord"("deptId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyMetricRecord_deptId_week_key" ON "WeeklyMetricRecord"("deptId", "week");

-- AddForeignKey
ALTER TABLE "WeeklyMetricRecord" ADD CONSTRAINT "WeeklyMetricRecord_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
