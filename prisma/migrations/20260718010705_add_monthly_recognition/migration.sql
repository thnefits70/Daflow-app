-- CreateTable
CREATE TABLE "MonthlyEvaluation" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "evaluateeId" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyEvaluationScore" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "pillar" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,

    CONSTRAINT "MonthlyEvaluationScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyRecognitionResult" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyRecognitionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyRecognitionPopupSeen" (
    "id" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyRecognitionPopupSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyEvaluation_month_idx" ON "MonthlyEvaluation"("month");

-- CreateIndex
CREATE INDEX "MonthlyEvaluation_evaluateeId_idx" ON "MonthlyEvaluation"("evaluateeId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyEvaluation_month_evaluateeId_key" ON "MonthlyEvaluation"("month", "evaluateeId");

-- CreateIndex
CREATE INDEX "MonthlyEvaluationScore_evaluationId_idx" ON "MonthlyEvaluationScore"("evaluationId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyEvaluationScore_evaluationId_questionId_key" ON "MonthlyEvaluationScore"("evaluationId", "questionId");

-- CreateIndex
CREATE INDEX "MonthlyRecognitionResult_month_idx" ON "MonthlyRecognitionResult"("month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyRecognitionResult_month_rank_key" ON "MonthlyRecognitionResult"("month", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyRecognitionPopupSeen_viewerId_month_key" ON "MonthlyRecognitionPopupSeen"("viewerId", "month");

-- AddForeignKey
ALTER TABLE "MonthlyEvaluation" ADD CONSTRAINT "MonthlyEvaluation_evaluateeId_fkey" FOREIGN KEY ("evaluateeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyEvaluationScore" ADD CONSTRAINT "MonthlyEvaluationScore_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "MonthlyEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyRecognitionResult" ADD CONSTRAINT "MonthlyRecognitionResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
