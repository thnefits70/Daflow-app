-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "lastMerchandiseReentryNumber" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MerchandiseReentryBatch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "batchNumber" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "danielApprovedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "MerchandiseReentryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchandiseReentryItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "photoUrls" TEXT[],
    "catalogItemId" TEXT,
    "aiRecognized" BOOLEAN NOT NULL DEFAULT false,
    "aiNote" TEXT,
    "declaredName" TEXT,
    "correctedName" TEXT,
    "correctedById" TEXT,
    "correctedAt" TIMESTAMP(3),
    "goodQty" INTEGER NOT NULL DEFAULT 0,
    "damagedQty" INTEGER NOT NULL DEFAULT 0,
    "damageReasonId" TEXT,
    "damageReasonOther" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "damageConfirmed" BOOLEAN,
    "damageConfirmedAt" TIMESTAMP(3),
    "damageConfirmedById" TEXT,
    "justUploadedAt" TIMESTAMP(3),
    "justUploadedById" TEXT,
    "writeOffAt" TIMESTAMP(3),
    "writeOffById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchandiseReentryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchandiseDamageReason" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchandiseDamageReason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchandiseReentryBatch_code_key" ON "MerchandiseReentryBatch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MerchandiseReentryBatch_batchNumber_key" ON "MerchandiseReentryBatch"("batchNumber");

-- CreateIndex
CREATE INDEX "MerchandiseReentryBatch_submittedAt_idx" ON "MerchandiseReentryBatch"("submittedAt");

-- CreateIndex
CREATE INDEX "MerchandiseReentryBatch_danielApprovedAt_idx" ON "MerchandiseReentryBatch"("danielApprovedAt");

-- CreateIndex
CREATE INDEX "MerchandiseReentryBatch_closedAt_idx" ON "MerchandiseReentryBatch"("closedAt");

-- CreateIndex
CREATE INDEX "MerchandiseReentryItem_batchId_idx" ON "MerchandiseReentryItem"("batchId");

-- CreateIndex
CREATE INDEX "MerchandiseReentryItem_catalogItemId_idx" ON "MerchandiseReentryItem"("catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchandiseDamageReason_name_key" ON "MerchandiseDamageReason"("name");

-- AddForeignKey
ALTER TABLE "MerchandiseReentryBatch" ADD CONSTRAINT "MerchandiseReentryBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseReentryItem" ADD CONSTRAINT "MerchandiseReentryItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MerchandiseReentryBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseReentryItem" ADD CONSTRAINT "MerchandiseReentryItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseReentryItem" ADD CONSTRAINT "MerchandiseReentryItem_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseReentryItem" ADD CONSTRAINT "MerchandiseReentryItem_damageReasonId_fkey" FOREIGN KEY ("damageReasonId") REFERENCES "MerchandiseDamageReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseReentryItem" ADD CONSTRAINT "MerchandiseReentryItem_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseReentryItem" ADD CONSTRAINT "MerchandiseReentryItem_damageConfirmedById_fkey" FOREIGN KEY ("damageConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseReentryItem" ADD CONSTRAINT "MerchandiseReentryItem_justUploadedById_fkey" FOREIGN KEY ("justUploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseReentryItem" ADD CONSTRAINT "MerchandiseReentryItem_writeOffById_fkey" FOREIGN KEY ("writeOffById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

