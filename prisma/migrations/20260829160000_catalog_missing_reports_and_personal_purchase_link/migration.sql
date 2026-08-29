-- AlterTable
ALTER TABLE "PersonalPurchaseItem" ADD COLUMN     "catalogItemId" TEXT,
ADD COLUMN     "confirmedCatalogItemId" TEXT;

-- CreateTable
CREATE TABLE "CatalogMissingReport" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "note" TEXT,
    "reportedById" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "CatalogMissingReport_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PersonalPurchaseItem" ADD CONSTRAINT "PersonalPurchaseItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalPurchaseItem" ADD CONSTRAINT "PersonalPurchaseItem_confirmedCatalogItemId_fkey" FOREIGN KEY ("confirmedCatalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogMissingReport" ADD CONSTRAINT "CatalogMissingReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogMissingReport" ADD CONSTRAINT "CatalogMissingReport_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
