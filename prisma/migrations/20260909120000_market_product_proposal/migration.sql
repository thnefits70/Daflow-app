-- CreateEnum
CREATE TYPE "MarketProductPlatform" AS ENUM ('DROPI', 'ROCKET', 'BOTH');

-- CreateEnum
CREATE TYPE "MarketProductStatus" AS ENUM ('PENDING_APPROVAL', 'REJECTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "MarketProductBodega" AS ENUM ('MKT_DAMIAN', 'MKT_PROVEDIX', 'MKT_SHANGHAI');

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "lastMarketProductProposalNumber" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "marketProductProposalId" TEXT;

-- CreateTable
CREATE TABLE "MarketProductProposal" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "referenceImageUrl" TEXT NOT NULL,
    "description" TEXT,
    "platform" "MarketProductPlatform" NOT NULL,
    "competitorId" TEXT,
    "competitorPrice" DOUBLE PRECISION,
    "competitorBodegaName" TEXT,
    "competitorProductName" TEXT,
    "insuranceRatePercent" DOUBLE PRECISION NOT NULL DEFAULT 6,
    "fulfillmentCost" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "marginPercent" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "calculatedSalePrice" DOUBLE PRECISION NOT NULL,
    "status" "MarketProductStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "rejectReason" TEXT,
    "proposedById" TEXT,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "bodega" "MarketProductBodega",
    "isPublic" BOOLEAN,
    "dropiProductId" TEXT,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "brandedById" TEXT,
    "brandedAt" TIMESTAMP(3),
    "catalogItemId" TEXT,
    "chosenSupplierId" TEXT,
    "readyToBuyAt" TIMESTAMP(3),
    "readyToBuyById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketProductProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketProductSupplierPrice" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "batchCost" DOUBLE PRECISION NOT NULL,
    "batchUnits" INTEGER NOT NULL,
    "freightCost" DOUBLE PRECISION,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketProductSupplierPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketProductPriceChange" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" DOUBLE PRECISION NOT NULL,
    "newValue" DOUBLE PRECISION NOT NULL,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketProductPriceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketProductProposal_code_key" ON "MarketProductProposal"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MarketProductProposal_catalogItemId_key" ON "MarketProductProposal"("catalogItemId");

-- CreateIndex
CREATE INDEX "MarketProductProposal_status_idx" ON "MarketProductProposal"("status");

-- CreateIndex
CREATE INDEX "MarketProductProposal_proposedById_idx" ON "MarketProductProposal"("proposedById");

-- CreateIndex
CREATE INDEX "MarketProductSupplierPrice_proposalId_idx" ON "MarketProductSupplierPrice"("proposalId");

-- CreateIndex
CREATE INDEX "MarketProductSupplierPrice_supplierId_idx" ON "MarketProductSupplierPrice"("supplierId");

-- CreateIndex
CREATE INDEX "MarketProductPriceChange_proposalId_idx" ON "MarketProductPriceChange"("proposalId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_marketProductProposalId_idx" ON "PurchaseRequest"("marketProductProposalId");

-- AddForeignKey
ALTER TABLE "MarketProductProposal" ADD CONSTRAINT "MarketProductProposal_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProductProposal" ADD CONSTRAINT "MarketProductProposal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProductProposal" ADD CONSTRAINT "MarketProductProposal_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProductProposal" ADD CONSTRAINT "MarketProductProposal_brandedById_fkey" FOREIGN KEY ("brandedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProductProposal" ADD CONSTRAINT "MarketProductProposal_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProductProposal" ADD CONSTRAINT "MarketProductProposal_chosenSupplierId_fkey" FOREIGN KEY ("chosenSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProductProposal" ADD CONSTRAINT "MarketProductProposal_readyToBuyById_fkey" FOREIGN KEY ("readyToBuyById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProductSupplierPrice" ADD CONSTRAINT "MarketProductSupplierPrice_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "MarketProductProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProductSupplierPrice" ADD CONSTRAINT "MarketProductSupplierPrice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProductPriceChange" ADD CONSTRAINT "MarketProductPriceChange_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "MarketProductProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProductPriceChange" ADD CONSTRAINT "MarketProductPriceChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_marketProductProposalId_fkey" FOREIGN KEY ("marketProductProposalId") REFERENCES "MarketProductProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

