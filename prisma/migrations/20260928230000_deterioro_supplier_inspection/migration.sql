-- AlterTable
ALTER TABLE "MerchandiseOutflowItem" ADD COLUMN     "inspectionReturnReceivedAt" TIMESTAMP(3),
ADD COLUMN     "inspectionReturnReceivedById" TEXT,
ADD COLUMN     "inspectionReturnsToWarehouse" BOOLEAN,
ADD COLUMN     "supplierInspectionNote" TEXT,
ADD COLUMN     "supplierInspectionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "supplierInspectionRequestedById" TEXT;
