-- CreateTable
CREATE TABLE "DropiCombo" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DropiCombo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DropiComboComponent" (
    "id" TEXT NOT NULL,
    "comboId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "DropiComboComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DropiCombo_code_key" ON "DropiCombo"("code");

-- CreateIndex
CREATE INDEX "DropiComboComponent_comboId_idx" ON "DropiComboComponent"("comboId");

-- CreateIndex
CREATE INDEX "DropiComboComponent_catalogItemId_idx" ON "DropiComboComponent"("catalogItemId");

-- AddForeignKey
ALTER TABLE "DropiCombo" ADD CONSTRAINT "DropiCombo_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DropiComboComponent" ADD CONSTRAINT "DropiComboComponent_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "DropiCombo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DropiComboComponent" ADD CONSTRAINT "DropiComboComponent_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

