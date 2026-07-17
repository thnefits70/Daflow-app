-- CreateTable
CREATE TABLE "WarrantyCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarrantyCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarrantyMonthTotal" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarrantyMonthTotal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarrantyCategoryMonthCount" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarrantyCategoryMonthCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarrantyCategory_name_key" ON "WarrantyCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WarrantyMonthTotal_month_key" ON "WarrantyMonthTotal"("month");

-- CreateIndex
CREATE INDEX "WarrantyCategoryMonthCount_month_idx" ON "WarrantyCategoryMonthCount"("month");

-- CreateIndex
CREATE INDEX "WarrantyCategoryMonthCount_categoryId_idx" ON "WarrantyCategoryMonthCount"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "WarrantyCategoryMonthCount_month_categoryId_key" ON "WarrantyCategoryMonthCount"("month", "categoryId");

-- AddForeignKey
ALTER TABLE "WarrantyCategoryMonthCount" ADD CONSTRAINT "WarrantyCategoryMonthCount_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "WarrantyCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
