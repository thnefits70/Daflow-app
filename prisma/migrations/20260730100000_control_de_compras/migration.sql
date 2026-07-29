-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canManagePurchases" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('SUPPLIER', 'CARRIER');

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "type" "SupplierType" NOT NULL DEFAULT 'SUPPLIER',
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "bankAccountType" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankAccountHolder" TEXT,
ADD COLUMN     "email" TEXT;

-- CreateIndex
CREATE INDEX "Supplier_type_idx" ON "Supplier"("type");

-- CreateTable
CREATE TABLE "PurchaseCatalogItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "photos" TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseCatalogItem_name_key" ON "PurchaseCatalogItem"("name");

-- AddForeignKey
ALTER TABLE "PurchaseCatalogItem" ADD CONSTRAINT "PurchaseCatalogItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PurchaseCatalogItemDeleteRequest" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "reason" TEXT,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseCatalogItemDeleteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseCatalogItemDeleteRequest_itemId_key" ON "PurchaseCatalogItemDeleteRequest"("itemId");

-- AddForeignKey
ALTER TABLE "PurchaseCatalogItemDeleteRequest" ADD CONSTRAINT "PurchaseCatalogItemDeleteRequest_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseCatalogItemDeleteRequest" ADD CONSTRAINT "PurchaseCatalogItemDeleteRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'PAID', 'RECEIVED');

-- CreateEnum
CREATE TYPE "PurchasePaymentMethod" AS ENUM ('TRANSFER', 'PETTY_CASH');

-- CreateEnum
CREATE TYPE "PurchaseInvoiceStatus" AS ENUM ('PENDING', 'COMPLETE', 'PARTIAL', 'NON_FISCAL', 'NONE');

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "quoteImageUrl" TEXT NOT NULL,
    "quoteReadTotal" DOUBLE PRECISION,
    "quoteReferenceCode" TEXT,
    "quoteConfirmedAt" TIMESTAMP(3),
    "shippingIncluded" BOOLEAN NOT NULL DEFAULT true,
    "carrierId" TEXT,
    "shippingCostTotal" DOUBLE PRECISION,
    "shippingPaymentMethod" "PurchasePaymentMethod",
    "justification" TEXT,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "rejectReason" TEXT,
    "requestedById" TEXT,
    "requestedByDeptId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentProofUrl" TEXT,
    "invoiceStatus" "PurchaseInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "invoiceAmount" DOUBLE PRECISION,
    "invoiceDocUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseRequest_deptId_idx" ON "PurchaseRequest"("deptId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_status_idx" ON "PurchaseRequest"("status");

-- CreateIndex
CREATE INDEX "PurchaseRequest_catalogItemId_idx" ON "PurchaseRequest"("catalogItemId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_supplierId_idx" ON "PurchaseRequest"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_requestedById_idx" ON "PurchaseRequest"("requestedById");

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PurchaseRequestReceipt" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "receivedQuantity" INTEGER NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "comment" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRequestReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequestReceipt_requestId_key" ON "PurchaseRequestReceipt"("requestId");

-- AddForeignKey
ALTER TABLE "PurchaseRequestReceipt" ADD CONSTRAINT "PurchaseRequestReceipt_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestReceipt" ADD CONSTRAINT "PurchaseRequestReceipt_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "PurchaseUrgentReportType" AS ENUM ('DAMAGED_INCOMPLETE', 'NOT_ARRIVED');

-- CreateTable
CREATE TABLE "PurchaseRequestUrgentReport" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" "PurchaseUrgentReportType" NOT NULL,
    "affectedQuantity" INTEGER,
    "description" TEXT NOT NULL,
    "reportedById" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRequestUrgentReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseRequestUrgentReport_requestId_idx" ON "PurchaseRequestUrgentReport"("requestId");

-- AddForeignKey
ALTER TABLE "PurchaseRequestUrgentReport" ADD CONSTRAINT "PurchaseRequestUrgentReport_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestUrgentReport" ADD CONSTRAINT "PurchaseRequestUrgentReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
