-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'RESOLVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "trackWeeklyReview" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WeeklyReviewRecord" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "week" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "actionPlan" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyReviewRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyReviewRecord_deptId_idx" ON "WeeklyReviewRecord"("deptId");

-- AddForeignKey
ALTER TABLE "WeeklyReviewRecord" ADD CONSTRAINT "WeeklyReviewRecord_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
