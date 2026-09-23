-- CreateTable
CREATE TABLE "NewIdBranding" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "proposalId" TEXT,
    "photos" TEXT[],
    "videoUrls" TEXT[],
    "brandedAt" TIMESTAMP(3),
    "brandedById" TEXT,
    "channelUploadedAt" TIMESTAMP(3),
    "channelUploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewIdBranding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewIdBranding_catalogItemId_key" ON "NewIdBranding"("catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "NewIdBranding_proposalId_key" ON "NewIdBranding"("proposalId");

-- AddForeignKey
ALTER TABLE "NewIdBranding" ADD CONSTRAINT "NewIdBranding_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewIdBranding" ADD CONSTRAINT "NewIdBranding_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "MarketProductProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewIdBranding" ADD CONSTRAINT "NewIdBranding_brandedById_fkey" FOREIGN KEY ("brandedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewIdBranding" ADD CONSTRAINT "NewIdBranding_channelUploadedById_fkey" FOREIGN KEY ("channelUploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

