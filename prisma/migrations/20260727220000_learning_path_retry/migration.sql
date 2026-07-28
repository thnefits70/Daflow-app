-- DropIndex
DROP INDEX "LearningPathStepProgress_stepId_userId_key";

-- AlterTable
ALTER TABLE "LearningPathStepProgress" ADD COLUMN     "attemptNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "correctCount" INTEGER,
ADD COLUMN     "retryAvailableAt" TIMESTAMP(3),
ADD COLUMN     "totalCount" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "LearningPathStepProgress_stepId_userId_attemptNumber_key" ON "LearningPathStepProgress"("stepId", "userId", "attemptNumber");
