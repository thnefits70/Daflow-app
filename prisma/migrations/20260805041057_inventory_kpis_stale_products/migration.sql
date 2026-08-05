-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canManageInventoryControl" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "defaultWorkspaceTab" TEXT;

-- CreateTable
CREATE TABLE "InventoryStaleProduct" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastConfirmedQuarter" TEXT NOT NULL,
    "quartersConfirmed" INTEGER NOT NULL DEFAULT 1,
    "recoveredQuarter" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryStaleProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryStaleProduct_deptId_idx" ON "InventoryStaleProduct"("deptId");

-- AddForeignKey
ALTER TABLE "InventoryStaleProduct" ADD CONSTRAINT "InventoryStaleProduct_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStaleProduct" ADD CONSTRAINT "InventoryStaleProduct_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStaleProduct" ADD CONSTRAINT "InventoryStaleProduct_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
