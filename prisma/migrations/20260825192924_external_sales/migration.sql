-- CreateEnum
CREATE TYPE "ExternalSaleReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "OutflowReason" ADD VALUE 'VENTA_EXTERNA';

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "lastExternalSaleNumber" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canDeclareExternalSales" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ExternalSale" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "saleNumber" INTEGER NOT NULL,
    "advisorId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "declaredProductName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "pickupPersonName" TEXT NOT NULL,
    "courierNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewStatus" "ExternalSaleReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectionReason" TEXT,
    "paymentProofUrl" TEXT,
    "paymentProofName" TEXT,
    "paymentProofUploadedAt" TIMESTAMP(3),
    "paymentConfirmedAt" TIMESTAMP(3),
    "paymentConfirmedById" TEXT,
    "dispatchAssignedToId" TEXT,
    "dispatchAssignedAt" TIMESTAMP(3),
    "dispatchAssignedById" TEXT,
    "deliveryPhotoUrl" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "deliveredById" TEXT,
    "nairobyClosedAt" TIMESTAMP(3),
    "nairobyClosedById" TEXT,
    "outflowBatchId" TEXT,

    CONSTRAINT "ExternalSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSale_code_key" ON "ExternalSale"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSale_saleNumber_key" ON "ExternalSale"("saleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSale_outflowBatchId_key" ON "ExternalSale"("outflowBatchId");

-- CreateIndex
CREATE INDEX "ExternalSale_reviewStatus_idx" ON "ExternalSale"("reviewStatus");

-- CreateIndex
CREATE INDEX "ExternalSale_dispatchAssignedToId_idx" ON "ExternalSale"("dispatchAssignedToId");

-- CreateIndex
CREATE INDEX "ExternalSale_advisorId_idx" ON "ExternalSale"("advisorId");

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_advisorId_fkey" FOREIGN KEY ("advisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_paymentConfirmedById_fkey" FOREIGN KEY ("paymentConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_dispatchAssignedToId_fkey" FOREIGN KEY ("dispatchAssignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_dispatchAssignedById_fkey" FOREIGN KEY ("dispatchAssignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_nairobyClosedById_fkey" FOREIGN KEY ("nairobyClosedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_outflowBatchId_fkey" FOREIGN KEY ("outflowBatchId") REFERENCES "MerchandiseOutflowBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

