-- AlterEnum
ALTER TYPE "FlowStepType" ADD VALUE 'CHECKLIST';

-- AlterTable
ALTER TABLE "FlowStep" ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "fileUrl" TEXT;

-- CreateTable
CREATE TABLE "FlowStepChecklistItem" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FlowStepChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlowStepChecklistItem_stepId_idx" ON "FlowStepChecklistItem"("stepId");

-- AddForeignKey
ALTER TABLE "FlowStepChecklistItem" ADD CONSTRAINT "FlowStepChecklistItem_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "FlowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
