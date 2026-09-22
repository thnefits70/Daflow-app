-- CreateTable
CREATE TABLE "CatalogItemMerge" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "removedItemId" TEXT NOT NULL,
    "removedName" TEXT NOT NULL,
    "removedJustCode" TEXT,
    "officialItemId" TEXT,
    "officialName" TEXT,
    "officialJustCode" TEXT,
    "summary" JSONB NOT NULL,
    "performedById" TEXT,
    "performedByName" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogItemMerge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogItemMerge_removedJustCode_idx" ON "CatalogItemMerge"("removedJustCode");

-- CreateIndex
CREATE INDEX "CatalogItemMerge_officialItemId_idx" ON "CatalogItemMerge"("officialItemId");

