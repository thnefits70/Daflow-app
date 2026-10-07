-- CreateTable
CREATE TABLE "StockCountShift" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "counted" INTEGER NOT NULL,

    CONSTRAINT "StockCountShift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockCountShift_assignmentId_idx" ON "StockCountShift"("assignmentId");

-- AddForeignKey
ALTER TABLE "StockCountShift" ADD CONSTRAINT "StockCountShift_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "StockCountAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
