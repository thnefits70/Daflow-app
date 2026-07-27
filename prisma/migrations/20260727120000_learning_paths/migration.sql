-- CreateEnum
CREATE TYPE "LearningPathQuestionType" AS ENUM ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'MATCHING', 'SHORT_ANSWER');

-- CreateTable
CREATE TABLE "LearningPath" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningPath_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningPathStep" (
    "id" TEXT NOT NULL,
    "pathId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "questionSetId" TEXT NOT NULL,

    CONSTRAINT "LearningPathStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentQuestionSet" (
    "id" TEXT NOT NULL,
    "documentId" TEXT,
    "processId" TEXT,
    "moduleId" TEXT,
    "aiModel" TEXT NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 10,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentQuestionSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningPathQuestion" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "type" "LearningPathQuestionType" NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "matchLeft" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "correctIndex" INTEGER,

    CONSTRAINT "LearningPathQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningPathAssignment" (
    "id" TEXT NOT NULL,
    "pathId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningPathAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningPathStepProgress" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "LearningPathStepProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningPathAnswer" (
    "id" TEXT NOT NULL,
    "progressId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedIndex" INTEGER,
    "matchOrder" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "textAnswer" TEXT,
    "isCorrect" BOOLEAN,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningPathAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningPathStep_pathId_idx" ON "LearningPathStep"("pathId");

-- CreateIndex
CREATE INDEX "LearningPathStep_questionSetId_idx" ON "LearningPathStep"("questionSetId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentQuestionSet_documentId_key" ON "ContentQuestionSet"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentQuestionSet_processId_key" ON "ContentQuestionSet"("processId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentQuestionSet_moduleId_key" ON "ContentQuestionSet"("moduleId");

-- CreateIndex
CREATE INDEX "LearningPathQuestion_setId_idx" ON "LearningPathQuestion"("setId");

-- CreateIndex
CREATE INDEX "LearningPathAssignment_userId_idx" ON "LearningPathAssignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningPathAssignment_pathId_userId_key" ON "LearningPathAssignment"("pathId", "userId");

-- CreateIndex
CREATE INDEX "LearningPathStepProgress_userId_idx" ON "LearningPathStepProgress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningPathStepProgress_stepId_userId_key" ON "LearningPathStepProgress"("stepId", "userId");

-- CreateIndex
CREATE INDEX "LearningPathAnswer_questionId_idx" ON "LearningPathAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningPathAnswer_progressId_questionId_key" ON "LearningPathAnswer"("progressId", "questionId");

-- AddForeignKey
ALTER TABLE "LearningPathStep" ADD CONSTRAINT "LearningPathStep_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "LearningPath"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPathStep" ADD CONSTRAINT "LearningPathStep_questionSetId_fkey" FOREIGN KEY ("questionSetId") REFERENCES "ContentQuestionSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentQuestionSet" ADD CONSTRAINT "ContentQuestionSet_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentQuestionSet" ADD CONSTRAINT "ContentQuestionSet_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentQuestionSet" ADD CONSTRAINT "ContentQuestionSet_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPathQuestion" ADD CONSTRAINT "LearningPathQuestion_setId_fkey" FOREIGN KEY ("setId") REFERENCES "ContentQuestionSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPathAssignment" ADD CONSTRAINT "LearningPathAssignment_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "LearningPath"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPathAssignment" ADD CONSTRAINT "LearningPathAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPathStepProgress" ADD CONSTRAINT "LearningPathStepProgress_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "LearningPathStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPathStepProgress" ADD CONSTRAINT "LearningPathStepProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPathAnswer" ADD CONSTRAINT "LearningPathAnswer_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "LearningPathStepProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPathAnswer" ADD CONSTRAINT "LearningPathAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "LearningPathQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

