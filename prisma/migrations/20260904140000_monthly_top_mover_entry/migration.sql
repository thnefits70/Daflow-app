-- CreateTable
CREATE TABLE "MonthlyTopMoverEntry" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "unitsMoved" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyTopMoverEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyTopMoverEntry_month_idx" ON "MonthlyTopMoverEntry"("month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyTopMoverEntry_month_catalogItemId_key" ON "MonthlyTopMoverEntry"("month", "catalogItemId");

-- AddForeignKey
ALTER TABLE "MonthlyTopMoverEntry" ADD CONSTRAINT "MonthlyTopMoverEntry_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyTopMoverEntry" ADD CONSTRAINT "MonthlyTopMoverEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

