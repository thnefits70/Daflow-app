-- DropTable
DROP TABLE "InventoryStaleProduct";

-- CreateTable
CREATE TABLE "InventoryProductSnapshot" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "avgCost" DOUBLE PRECISION NOT NULL,
    "stock" DOUBLE PRECISION NOT NULL,
    "costTotal" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryProductSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryProductSnapshot_deptId_period_idx" ON "InventoryProductSnapshot"("deptId", "period");

-- CreateIndex
CREATE INDEX "InventoryProductSnapshot_productCode_idx" ON "InventoryProductSnapshot"("productCode");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryProductSnapshot_deptId_period_productCode_key" ON "InventoryProductSnapshot"("deptId", "period", "productCode");

-- AddForeignKey
ALTER TABLE "InventoryProductSnapshot" ADD CONSTRAINT "InventoryProductSnapshot_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryProductSnapshot" ADD CONSTRAINT "InventoryProductSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
