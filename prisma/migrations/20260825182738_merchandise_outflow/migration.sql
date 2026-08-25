-- CreateEnum
CREATE TYPE "OutflowReason" AS ENUM ('DESPACHO', 'GARANTIA', 'DETERIORO', 'COMPRA_PERSONAL');

-- CreateEnum
CREATE TYPE "OutflowItemResolution" AS ENUM ('SOLVED_ONSITE', 'WRITE_OFF', 'ESCALATED_TO_PURCHASES');

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "lastMerchandiseOutflowNumber" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MerchandiseOutflowBatch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "batchNumber" INTEGER NOT NULL,
    "reason" "OutflowReason" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentPhotoUrls" TEXT[],
    "submittedAt" TIMESTAMP(3),
    "justWrittenOffAt" TIMESTAMP(3),
    "justWrittenOffById" TEXT,
    "personalPurchaseItemId" TEXT,

    CONSTRAINT "MerchandiseOutflowBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchandiseOutflowItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "declaredName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "photoUrls" TEXT[],
    "damageReasonId" TEXT,
    "damageReasonOther" TEXT,
    "resolution" "OutflowItemResolution",
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchandiseOutflowItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchandiseOutflowBatch_code_key" ON "MerchandiseOutflowBatch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MerchandiseOutflowBatch_batchNumber_key" ON "MerchandiseOutflowBatch"("batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MerchandiseOutflowBatch_personalPurchaseItemId_key" ON "MerchandiseOutflowBatch"("personalPurchaseItemId");

-- CreateIndex
CREATE INDEX "MerchandiseOutflowBatch_reason_idx" ON "MerchandiseOutflowBatch"("reason");

-- CreateIndex
CREATE INDEX "MerchandiseOutflowBatch_submittedAt_idx" ON "MerchandiseOutflowBatch"("submittedAt");

-- CreateIndex
CREATE INDEX "MerchandiseOutflowBatch_justWrittenOffAt_idx" ON "MerchandiseOutflowBatch"("justWrittenOffAt");

-- CreateIndex
CREATE INDEX "MerchandiseOutflowItem_batchId_idx" ON "MerchandiseOutflowItem"("batchId");

-- CreateIndex
CREATE INDEX "MerchandiseOutflowItem_resolution_idx" ON "MerchandiseOutflowItem"("resolution");

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowBatch" ADD CONSTRAINT "MerchandiseOutflowBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowBatch" ADD CONSTRAINT "MerchandiseOutflowBatch_justWrittenOffById_fkey" FOREIGN KEY ("justWrittenOffById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowBatch" ADD CONSTRAINT "MerchandiseOutflowBatch_personalPurchaseItemId_fkey" FOREIGN KEY ("personalPurchaseItemId") REFERENCES "PersonalPurchaseItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MerchandiseOutflowBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_damageReasonId_fkey" FOREIGN KEY ("damageReasonId") REFERENCES "MerchandiseDamageReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

