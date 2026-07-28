-- AlterTable
ALTER TABLE "FinanceKpiSettings" ADD COLUMN     "excelenteMargenBruto" DOUBLE PRECISION NOT NULL DEFAULT 40,
ADD COLUMN     "excelenteMargenOperativo" DOUBLE PRECISION NOT NULL DEFAULT 30,
ALTER COLUMN "targetMargenBruto" SET DEFAULT 30,
ALTER COLUMN "targetMargenOperativo" SET DEFAULT 20;
