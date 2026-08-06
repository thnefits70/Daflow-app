-- AlterTable: photoUrl (String) -> photoUrls (String[]), preserving existing rows.
ALTER TABLE "PurchaseRequestReceipt" ADD COLUMN "photoUrls" TEXT[] NOT NULL DEFAULT '{}';
UPDATE "PurchaseRequestReceipt" SET "photoUrls" = ARRAY["photoUrl"]::TEXT[];
ALTER TABLE "PurchaseRequestReceipt" DROP COLUMN "photoUrl";
ALTER TABLE "PurchaseRequestReceipt" ALTER COLUMN "photoUrls" DROP DEFAULT;

-- AlterTable: advisory AI comparison result (never blocks, only informational).
ALTER TABLE "PurchaseRequestReceipt" ADD COLUMN "aiPhotoMatch" BOOLEAN;
ALTER TABLE "PurchaseRequestReceipt" ADD COLUMN "aiPhotoNote" TEXT;
