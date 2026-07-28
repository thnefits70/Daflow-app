-- AlterTable
ALTER TABLE "PeriodicReminder" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "notifyPush" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "PeriodicReminder_createdById_idx" ON "PeriodicReminder"("createdById");

-- AddForeignKey
ALTER TABLE "PeriodicReminder" ADD CONSTRAINT "PeriodicReminder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
