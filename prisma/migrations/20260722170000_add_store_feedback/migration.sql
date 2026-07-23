-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreFeedbackEvaluation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "loyaltyScore" INTEGER NOT NULL,
    "fulfillmentScore" INTEGER NOT NULL,
    "qualityScore" INTEGER NOT NULL,
    "stockScore" INTEGER NOT NULL,
    "responseTimeScore" INTEGER NOT NULL,
    "commercialTermsScore" INTEGER NOT NULL,
    "communicationScore" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "evaluatedById" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreFeedbackEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Store_order_idx" ON "Store"("order");

-- CreateIndex
CREATE INDEX "StoreFeedbackEvaluation_storeId_idx" ON "StoreFeedbackEvaluation"("storeId");

-- AddForeignKey
ALTER TABLE "StoreFeedbackEvaluation" ADD CONSTRAINT "StoreFeedbackEvaluation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreFeedbackEvaluation" ADD CONSTRAINT "StoreFeedbackEvaluation_evaluatedById_fkey" FOREIGN KEY ("evaluatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
