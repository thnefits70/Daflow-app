-- AlterTable
ALTER TABLE "User" ADD COLUMN "canUploadRocketSku" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MarketProductProposal" ADD COLUMN "rocketOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "rocketProductId" TEXT,
ADD COLUMN "rocketSku" TEXT,
ADD COLUMN "rocketSkuAt" TIMESTAMP(3),
ADD COLUMN "rocketSkuById" TEXT,
ADD COLUMN "publicRequestedAt" TIMESTAMP(3),
ADD COLUMN "publicRequestedById" TEXT,
ADD COLUMN "madePublicAt" TIMESTAMP(3),
ADD COLUMN "madePublicById" TEXT;

-- AddForeignKey
ALTER TABLE "MarketProductProposal" ADD CONSTRAINT "MarketProductProposal_rocketSkuById_fkey" FOREIGN KEY ("rocketSkuById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProductProposal" ADD CONSTRAINT "MarketProductProposal_publicRequestedById_fkey" FOREIGN KEY ("publicRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProductProposal" ADD CONSTRAINT "MarketProductProposal_madePublicById_fkey" FOREIGN KEY ("madePublicById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
