-- AlterTable
ALTER TABLE "NickDropiAccount" ADD COLUMN     "lastSyncAt" TIMESTAMP(3),
ADD COLUMN     "syncDay" TEXT,
ADD COLUMN     "syncLockUntil" TIMESTAMP(3),
ADD COLUMN     "syncStart" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "NickGuideStatus" (
    "guideNumber" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dropiOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusGroup" TEXT NOT NULL,
    "carrier" TEXT,
    "city" TEXT,
    "rateType" TEXT,
    "orderCreatedAt" TIMESTAMP(3),
    "statusSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NickGuideStatus_pkey" PRIMARY KEY ("guideNumber")
);

-- CreateTable
CREATE TABLE "NickGuideStatusChange" (
    "id" TEXT NOT NULL,
    "guideNumber" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NickGuideStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NickGuideStatus_statusGroup_idx" ON "NickGuideStatus"("statusGroup");

-- CreateIndex
CREATE INDEX "NickGuideStatus_accountId_idx" ON "NickGuideStatus"("accountId");

-- CreateIndex
CREATE INDEX "NickGuideStatus_lastSeenAt_idx" ON "NickGuideStatus"("lastSeenAt");

-- CreateIndex
CREATE INDEX "NickGuideStatusChange_guideNumber_at_idx" ON "NickGuideStatusChange"("guideNumber", "at");


-- Mismo criterio que 20261012170000: tablas cerradas a la API REST de Supabase.
ALTER TABLE "NickGuideStatus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NickGuideStatusChange" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "NickGuideStatus" FROM anon, authenticated;
REVOKE ALL ON TABLE "NickGuideStatusChange" FROM anon, authenticated;
