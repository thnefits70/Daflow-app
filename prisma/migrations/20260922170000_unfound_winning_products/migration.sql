-- CreateEnum
CREATE TYPE "UnfoundWinningProductStatus" AS ENUM ('PENDING', 'PROPOSED', 'DISCARDED');

-- CreateTable
CREATE TABLE "UnfoundWinningProduct" (
    "id" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "competitorId" TEXT,
    "competitorPrice" DOUBLE PRECISION,
    "supplierId" TEXT,
    "notes" TEXT,
    "weekYear" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "status" "UnfoundWinningProductStatus" NOT NULL DEFAULT 'PENDING',
    "proposalId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnfoundWinningProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnfoundWinningProduct_status_idx" ON "UnfoundWinningProduct"("status");

-- CreateIndex
CREATE INDEX "UnfoundWinningProduct_weekYear_weekNumber_idx" ON "UnfoundWinningProduct"("weekYear", "weekNumber");

-- AddForeignKey
ALTER TABLE "UnfoundWinningProduct" ADD CONSTRAINT "UnfoundWinningProduct_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnfoundWinningProduct" ADD CONSTRAINT "UnfoundWinningProduct_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "MarketProductProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnfoundWinningProduct" ADD CONSTRAINT "UnfoundWinningProduct_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

