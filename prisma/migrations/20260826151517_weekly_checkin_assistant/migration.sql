-- CreateEnum
CREATE TYPE "ReviewSource" AS ENUM ('ADMIN_MANUAL', 'ASSISTANT');

-- AlterTable
ALTER TABLE "WeeklyReviewRecord" ADD COLUMN     "involvedNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "involvesDeptId" TEXT,
ADD COLUMN     "involvesRaw" TEXT,
ADD COLUMN     "involvesUserId" TEXT,
ADD COLUMN     "reportedById" TEXT,
ADD COLUMN     "source" "ReviewSource" NOT NULL DEFAULT 'ADMIN_MANUAL';

-- CreateTable
CREATE TABLE "CheckinConversation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "weekOf" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckinConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckinMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckinMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckinConversation_ownerId_weekOf_idx" ON "CheckinConversation"("ownerId", "weekOf");

-- CreateIndex
CREATE INDEX "CheckinConversation_deptId_idx" ON "CheckinConversation"("deptId");

-- CreateIndex
CREATE INDEX "CheckinMessage_conversationId_idx" ON "CheckinMessage"("conversationId");

-- CreateIndex
CREATE INDEX "WeeklyReviewRecord_reportedById_idx" ON "WeeklyReviewRecord"("reportedById");

-- CreateIndex
CREATE INDEX "WeeklyReviewRecord_involvesDeptId_idx" ON "WeeklyReviewRecord"("involvesDeptId");

-- AddForeignKey
ALTER TABLE "WeeklyReviewRecord" ADD CONSTRAINT "WeeklyReviewRecord_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReviewRecord" ADD CONSTRAINT "WeeklyReviewRecord_involvesDeptId_fkey" FOREIGN KEY ("involvesDeptId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReviewRecord" ADD CONSTRAINT "WeeklyReviewRecord_involvesUserId_fkey" FOREIGN KEY ("involvesUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckinConversation" ADD CONSTRAINT "CheckinConversation_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckinMessage" ADD CONSTRAINT "CheckinMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CheckinConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

