-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "trackKpis" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FinanceKpiRecord" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "roi" DOUBLE PRECISION,
    "monthlySales" DOUBLE PRECISION,
    "monthlyProfit" DOUBLE PRECISION,
    "notes" TEXT NOT NULL DEFAULT '',
    "fileUrl" TEXT,
    "fileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceKpiRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceKpiRecord_deptId_idx" ON "FinanceKpiRecord"("deptId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceKpiRecord_deptId_period_key" ON "FinanceKpiRecord"("deptId", "period");

-- AddForeignKey
ALTER TABLE "FinanceKpiRecord" ADD CONSTRAINT "FinanceKpiRecord_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
