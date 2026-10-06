-- CreateTable
CREATE TABLE "ProductVariantAlias" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "variantId" TEXT,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVariantAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductVariantAlias_catalogItemId_idx" ON "ProductVariantAlias"("catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariantAlias_catalogItemId_label_key" ON "ProductVariantAlias"("catalogItemId", "label");

-- AddForeignKey
ALTER TABLE "ProductVariantAlias" ADD CONSTRAINT "ProductVariantAlias_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantAlias" ADD CONSTRAINT "ProductVariantAlias_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

