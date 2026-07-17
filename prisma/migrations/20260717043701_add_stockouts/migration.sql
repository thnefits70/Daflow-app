-- CreateTable
CREATE TABLE "StockoutProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockoutProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockoutWeekProduct" (
    "id" TEXT NOT NULL,
    "week" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockoutWeekProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockoutProduct_name_key" ON "StockoutProduct"("name");

-- CreateIndex
CREATE INDEX "StockoutWeekProduct_week_idx" ON "StockoutWeekProduct"("week");

-- CreateIndex
CREATE INDEX "StockoutWeekProduct_productId_idx" ON "StockoutWeekProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockoutWeekProduct_week_productId_key" ON "StockoutWeekProduct"("week", "productId");

-- AddForeignKey
ALTER TABLE "StockoutWeekProduct" ADD CONSTRAINT "StockoutWeekProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "StockoutProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
