-- DropIndex
DROP INDEX "FinanceKpiRecord_deptId_period_key";

-- AlterTable
ALTER TABLE "FinanceKpiRecord" DROP COLUMN "fileName",
DROP COLUMN "fileUrl",
DROP COLUMN "monthlyProfit",
DROP COLUMN "monthlySales",
DROP COLUMN "notes",
ADD COLUMN     "costoVentas" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "gastosAdmin" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "gastosFinancieros" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "gastosVenta" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "operationId" TEXT NOT NULL,
ADD COLUMN     "otrosGastos" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "otrosIngresos" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "uploadedById" TEXT,
ADD COLUMN     "ventas" DOUBLE PRECISION NOT NULL;

-- CreateTable
CREATE TABLE "FinanceOperation" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceSharedMonthlyBalance" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "inventarioFinal" DOUBLE PRECISION,
    "cuentasPorCobrar" DOUBLE PRECISION,
    "cuentasPorPagar" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceSharedMonthlyBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceKpiUpload" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "uploadedById" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "isCorrection" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceKpiUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceKpiSettings" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "targetMargenBruto" DOUBLE PRECISION NOT NULL DEFAULT 35,
    "targetMargenOperativo" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "targetMargenNeto" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "roiBandRed" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "roiBandYellow" DOUBLE PRECISION NOT NULL DEFAULT 18,
    "roiBandTarget" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "taxRatePct" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceKpiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceOperation_deptId_idx" ON "FinanceOperation"("deptId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceOperation_deptId_name_key" ON "FinanceOperation"("deptId", "name");

-- CreateIndex
CREATE INDEX "FinanceSharedMonthlyBalance_deptId_idx" ON "FinanceSharedMonthlyBalance"("deptId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceSharedMonthlyBalance_deptId_period_key" ON "FinanceSharedMonthlyBalance"("deptId", "period");

-- CreateIndex
CREATE INDEX "FinanceKpiUpload_deptId_idx" ON "FinanceKpiUpload"("deptId");

-- CreateIndex
CREATE INDEX "FinanceKpiUpload_period_idx" ON "FinanceKpiUpload"("period");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceKpiSettings_deptId_key" ON "FinanceKpiSettings"("deptId");

-- CreateIndex
CREATE INDEX "FinanceKpiRecord_operationId_idx" ON "FinanceKpiRecord"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceKpiRecord_operationId_period_key" ON "FinanceKpiRecord"("operationId", "period");

-- AddForeignKey
ALTER TABLE "FinanceOperation" ADD CONSTRAINT "FinanceOperation_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceKpiRecord" ADD CONSTRAINT "FinanceKpiRecord_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "FinanceOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceKpiRecord" ADD CONSTRAINT "FinanceKpiRecord_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceSharedMonthlyBalance" ADD CONSTRAINT "FinanceSharedMonthlyBalance_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceKpiUpload" ADD CONSTRAINT "FinanceKpiUpload_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceKpiUpload" ADD CONSTRAINT "FinanceKpiUpload_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceKpiSettings" ADD CONSTRAINT "FinanceKpiSettings_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

