-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "adminBirthDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "birthDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BirthdayPopupSeen" (
    "id" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "celebrantId" TEXT NOT NULL,
    "celebrationDate" TIMESTAMP(3) NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BirthdayPopupSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BirthdayPopupSeen_viewerId_celebrationDate_idx" ON "BirthdayPopupSeen"("viewerId", "celebrationDate");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayPopupSeen_viewerId_celebrantId_celebrationDate_key" ON "BirthdayPopupSeen"("viewerId", "celebrantId", "celebrationDate");
