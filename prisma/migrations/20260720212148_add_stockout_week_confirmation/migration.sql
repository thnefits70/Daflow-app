-- CreateTable
CREATE TABLE "StockoutWeekConfirmation" (
    "id" TEXT NOT NULL,
    "week" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockoutWeekConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockoutWeekConfirmation_week_key" ON "StockoutWeekConfirmation"("week");
