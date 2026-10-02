-- CreateTable
CREATE TABLE "PurchaseSuggestionDiscard" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "statusAtDiscard" TEXT NOT NULL,
    "stockAtDiscard" INTEGER NOT NULL,
    "daysLeftAtDiscard" DOUBLE PRECISION,
    "discardedById" TEXT,
    "discardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,

    CONSTRAINT "PurchaseSuggestionDiscard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseSuggestionDiscard_catalogItemId_idx" ON "PurchaseSuggestionDiscard"("catalogItemId");

-- CreateIndex
CREATE INDEX "PurchaseSuggestionDiscard_discardedAt_idx" ON "PurchaseSuggestionDiscard"("discardedAt");

-- AddForeignKey
ALTER TABLE "PurchaseSuggestionDiscard" ADD CONSTRAINT "PurchaseSuggestionDiscard_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
