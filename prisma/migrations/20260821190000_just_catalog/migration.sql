-- AlterTable
ALTER TABLE "PurchaseCatalogItem" ADD COLUMN     "justCode" TEXT,
ADD COLUMN     "pendingRegistration" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "JustCatalogImport" (
    "id" TEXT NOT NULL,
    "importedById" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalRows" INTEGER NOT NULL,
    "createdCount" INTEGER NOT NULL,
    "linkedCount" INTEGER NOT NULL,
    "renamedCount" INTEGER NOT NULL,

    CONSTRAINT "JustCatalogImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JustCatalogImport_importedAt_idx" ON "JustCatalogImport"("importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseCatalogItem_justCode_key" ON "PurchaseCatalogItem"("justCode");

-- AddForeignKey
ALTER TABLE "JustCatalogImport" ADD CONSTRAINT "JustCatalogImport_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

