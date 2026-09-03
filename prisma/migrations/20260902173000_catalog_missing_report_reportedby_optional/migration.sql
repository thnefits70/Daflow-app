-- DropForeignKey
ALTER TABLE "CatalogMissingReport" DROP CONSTRAINT "CatalogMissingReport_reportedById_fkey";

-- AlterTable
ALTER TABLE "CatalogMissingReport" ALTER COLUMN "reportedById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "CatalogMissingReport" ADD CONSTRAINT "CatalogMissingReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

