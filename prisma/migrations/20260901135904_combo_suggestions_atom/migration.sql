-- CreateEnum
CREATE TYPE "AtomRentabilityStatus" AS ENUM ('RENTABLE', 'SEGUIMIENTO');

-- CreateEnum
CREATE TYPE "ComboSuggestionStatus" AS ENUM ('SUGERIDO', 'SELECCIONADO', 'PENDIENTE_APROBACION', 'APROBADO', 'RECHAZADO', 'CREADO_EN_DROPI');

-- AlterTable
ALTER TABLE "PurchaseCatalogItem" ADD COLUMN     "nicho" TEXT;

-- CreateTable
CREATE TABLE "AtomProductStatus" (
    "id" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "status" "AtomRentabilityStatus" NOT NULL,
    "isCombo" BOOLEAN NOT NULL DEFAULT false,
    "matchedCatalogItemId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AtomProductStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LowRotationWeeklyEntry" (
    "id" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "unitsDispatched" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LowRotationWeeklyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboSuggestion" (
    "id" TEXT NOT NULL,
    "nicho" TEXT NOT NULL,
    "winnerCatalogItemId" TEXT NOT NULL,
    "lowRotationCatalogItemId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batchId" TEXT,
    "status" "ComboSuggestionStatus" NOT NULL DEFAULT 'SUGERIDO',
    "selectedById" TEXT,
    "sentForApprovalAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdInDropiAt" TIMESTAMP(3),
    "createdInDropiById" TEXT,

    CONSTRAINT "ComboSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AtomProductStatus_capturedAt_idx" ON "AtomProductStatus"("capturedAt");

-- CreateIndex
CREATE INDEX "AtomProductStatus_matchedCatalogItemId_idx" ON "AtomProductStatus"("matchedCatalogItemId");

-- CreateIndex
CREATE INDEX "LowRotationWeeklyEntry_weekOf_idx" ON "LowRotationWeeklyEntry"("weekOf");

-- CreateIndex
CREATE UNIQUE INDEX "LowRotationWeeklyEntry_weekOf_catalogItemId_key" ON "LowRotationWeeklyEntry"("weekOf", "catalogItemId");

-- CreateIndex
CREATE INDEX "ComboSuggestion_status_idx" ON "ComboSuggestion"("status");

-- CreateIndex
CREATE INDEX "ComboSuggestion_batchId_idx" ON "ComboSuggestion"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "ComboSuggestion_winnerCatalogItemId_lowRotationCatalogItemI_key" ON "ComboSuggestion"("winnerCatalogItemId", "lowRotationCatalogItemId");

-- AddForeignKey
ALTER TABLE "AtomProductStatus" ADD CONSTRAINT "AtomProductStatus_matchedCatalogItemId_fkey" FOREIGN KEY ("matchedCatalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtomProductStatus" ADD CONSTRAINT "AtomProductStatus_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LowRotationWeeklyEntry" ADD CONSTRAINT "LowRotationWeeklyEntry_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LowRotationWeeklyEntry" ADD CONSTRAINT "LowRotationWeeklyEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboSuggestion" ADD CONSTRAINT "ComboSuggestion_winnerCatalogItemId_fkey" FOREIGN KEY ("winnerCatalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboSuggestion" ADD CONSTRAINT "ComboSuggestion_lowRotationCatalogItemId_fkey" FOREIGN KEY ("lowRotationCatalogItemId") REFERENCES "PurchaseCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboSuggestion" ADD CONSTRAINT "ComboSuggestion_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboSuggestion" ADD CONSTRAINT "ComboSuggestion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboSuggestion" ADD CONSTRAINT "ComboSuggestion_createdInDropiById_fkey" FOREIGN KEY ("createdInDropiById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

