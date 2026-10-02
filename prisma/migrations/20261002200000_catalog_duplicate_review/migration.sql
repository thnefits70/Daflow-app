-- CreateTable
CREATE TABLE "CatalogDuplicateReview" (
    "id" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "itemAId" TEXT NOT NULL,
    "itemBId" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogDuplicateReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogDuplicateReview_pairKey_key" ON "CatalogDuplicateReview"("pairKey");

