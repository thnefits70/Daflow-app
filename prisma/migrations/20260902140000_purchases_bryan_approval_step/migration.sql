-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canApprovePurchaseRequests" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purchasingNewRequestsBlocked" BOOLEAN NOT NULL DEFAULT false;
