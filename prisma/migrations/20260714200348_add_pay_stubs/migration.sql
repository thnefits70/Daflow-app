-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSeenPayStubAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PayStub" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deptId" TEXT,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayStub_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayStub_userId_idx" ON "PayStub"("userId");

-- CreateIndex
CREATE INDEX "PayStub_deptId_idx" ON "PayStub"("deptId");

-- CreateIndex
CREATE UNIQUE INDEX "PayStub_userId_month_year_key" ON "PayStub"("userId", "month", "year");

-- AddForeignKey
ALTER TABLE "PayStub" ADD CONSTRAINT "PayStub_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayStub" ADD CONSTRAINT "PayStub_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
