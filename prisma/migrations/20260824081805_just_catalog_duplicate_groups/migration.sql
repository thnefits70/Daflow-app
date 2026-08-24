-- AlterTable
ALTER TABLE "JustCatalogImport" ADD COLUMN     "duplicateGroupsResolved" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "duplicateGroupsTotal" INTEGER NOT NULL DEFAULT 0;

