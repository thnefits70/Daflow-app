-- CreateTable
CREATE TABLE "PettyCashReservation" (
    "id" TEXT NOT NULL,
    "boxId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "releaseReason" TEXT,
    "releasedByEntryId" TEXT,

    CONSTRAINT "PettyCashReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PettyCashReservation_boxId_idx" ON "PettyCashReservation"("boxId");

-- AddForeignKey
ALTER TABLE "PettyCashReservation" ADD CONSTRAINT "PettyCashReservation_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "PettyCashBox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashReservation" ADD CONSTRAINT "PettyCashReservation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashReservation" ADD CONSTRAINT "PettyCashReservation_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
