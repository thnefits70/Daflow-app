-- CreateEnum
CREATE TYPE "PettyCashBoxType" AS ENUM ('PRINCIPAL', 'SECUNDARIA');

-- CreateEnum
CREATE TYPE "PettyCashEntryKind" AS ENUM ('DESEMBOLSO', 'RECARGA');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canManagePettyCashSecundaria" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PettyCashBox" (
    "id" TEXT NOT NULL,
    "type" "PettyCashBoxType" NOT NULL,
    "minThreshold" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PettyCashBox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCashEntry" (
    "id" TEXT NOT NULL,
    "boxId" TEXT NOT NULL,
    "kind" "PettyCashEntryKind" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "proofUrl" TEXT,
    "proofHash" TEXT,
    "aiReadAmount" DOUBLE PRECISION,
    "aiMatches" BOOLEAN,
    "linkedGroupId" TEXT,
    "manualReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "fundingReminderSentAt" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "restoredAt" TIMESTAMP(3),
    "restoredById" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PettyCashEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCashFreightException" (
    "id" TEXT NOT NULL,
    "boxId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PettyCashFreightException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashBox_type_key" ON "PettyCashBox"("type");

-- CreateIndex
CREATE INDEX "PettyCashEntry_boxId_idx" ON "PettyCashEntry"("boxId");

-- CreateIndex
CREATE INDEX "PettyCashEntry_linkedGroupId_idx" ON "PettyCashEntry"("linkedGroupId");

-- CreateIndex
CREATE INDEX "PettyCashFreightException_boxId_idx" ON "PettyCashFreightException"("boxId");

-- CreateIndex
CREATE INDEX "PettyCashFreightException_groupId_idx" ON "PettyCashFreightException"("groupId");

-- AddForeignKey
ALTER TABLE "PettyCashEntry" ADD CONSTRAINT "PettyCashEntry_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "PettyCashBox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashEntry" ADD CONSTRAINT "PettyCashEntry_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashEntry" ADD CONSTRAINT "PettyCashEntry_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashEntry" ADD CONSTRAINT "PettyCashEntry_restoredById_fkey" FOREIGN KEY ("restoredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashEntry" ADD CONSTRAINT "PettyCashEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashEntry" ADD CONSTRAINT "PettyCashEntry_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashFreightException" ADD CONSTRAINT "PettyCashFreightException_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "PettyCashBox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashFreightException" ADD CONSTRAINT "PettyCashFreightException_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashFreightException" ADD CONSTRAINT "PettyCashFreightException_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
