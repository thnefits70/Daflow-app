-- CreateTable
CREATE TABLE "MonthlyEvaluationSummary" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "evaluateeId" TEXT NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "resultadosScore" INTEGER NOT NULL,
    "excelenciaScore" INTEGER NOT NULL,
    "compromisoScore" INTEGER NOT NULL,
    "colaboracionScore" INTEGER NOT NULL,
    "clienteScore" INTEGER NOT NULL,
    "innovacionScore" INTEGER NOT NULL,
    "liderazgoScore" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyEvaluationSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyEvaluationSummary_month_idx" ON "MonthlyEvaluationSummary"("month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyEvaluationSummary_month_evaluateeId_key" ON "MonthlyEvaluationSummary"("month", "evaluateeId");

-- AddForeignKey
ALTER TABLE "MonthlyEvaluationSummary" ADD CONSTRAINT "MonthlyEvaluationSummary_evaluateeId_fkey" FOREIGN KEY ("evaluateeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
