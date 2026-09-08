-- CreateTable
CREATE TABLE "LeaderTeamFeedback" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "positiveComment" TEXT NOT NULL,
    "improvementComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderTeamFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderTeamFeedbackScore" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,

    CONSTRAINT "LeaderTeamFeedbackScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderExternalObservation" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "observerId" TEXT NOT NULL,
    "positiveComment" TEXT NOT NULL,
    "improvementComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderExternalObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminLeadershipFeedback" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "positiveComment" TEXT NOT NULL,
    "improvementComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminLeadershipFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminLeadershipFeedbackScore" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,

    CONSTRAINT "AdminLeadershipFeedbackScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminLeadershipObservation" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "observerId" TEXT NOT NULL,
    "positiveComment" TEXT NOT NULL,
    "improvementComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminLeadershipObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaderTeamFeedback_month_leaderId_idx" ON "LeaderTeamFeedback"("month", "leaderId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderTeamFeedback_month_leaderId_evaluatorId_key" ON "LeaderTeamFeedback"("month", "leaderId", "evaluatorId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderTeamFeedbackScore_feedbackId_questionId_key" ON "LeaderTeamFeedbackScore"("feedbackId", "questionId");

-- CreateIndex
CREATE INDEX "LeaderExternalObservation_month_leaderId_idx" ON "LeaderExternalObservation"("month", "leaderId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderExternalObservation_month_leaderId_observerId_key" ON "LeaderExternalObservation"("month", "leaderId", "observerId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminLeadershipFeedback_month_evaluatorId_key" ON "AdminLeadershipFeedback"("month", "evaluatorId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminLeadershipFeedbackScore_feedbackId_questionId_key" ON "AdminLeadershipFeedbackScore"("feedbackId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminLeadershipObservation_month_observerId_key" ON "AdminLeadershipObservation"("month", "observerId");

-- AddForeignKey
ALTER TABLE "LeaderTeamFeedback" ADD CONSTRAINT "LeaderTeamFeedback_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderTeamFeedbackScore" ADD CONSTRAINT "LeaderTeamFeedbackScore_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "LeaderTeamFeedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderExternalObservation" ADD CONSTRAINT "LeaderExternalObservation_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminLeadershipFeedbackScore" ADD CONSTRAINT "AdminLeadershipFeedbackScore_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "AdminLeadershipFeedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

