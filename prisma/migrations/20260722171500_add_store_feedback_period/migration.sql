-- AlterTable
ALTER TABLE "StoreFeedbackEvaluation" ADD COLUMN     "period" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "StoreFeedbackEvaluation_period_idx" ON "StoreFeedbackEvaluation"("period");
