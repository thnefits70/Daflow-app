-- AlterTable
ALTER TABLE "MarketProductProposal" ADD COLUMN     "kardexReleasedAt" TIMESTAMP(3),
ADD COLUMN     "kardexReleasedById" TEXT;

-- AlterTable
ALTER TABLE "PurchaseCatalogItem" ADD COLUMN     "awaitingDropiId" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "MarketProductProposal" ADD CONSTRAINT "MarketProductProposal_kardexReleasedById_fkey" FOREIGN KEY ("kardexReleasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

